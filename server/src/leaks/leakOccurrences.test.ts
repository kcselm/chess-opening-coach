import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getLeakOccurrences } from "./leakOccurrences.js";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE games (id text primary key, source text, url text, username text,
    my_color text, result text, time_class text, end_time integer, eco text, opening_name text,
    my_rating integer, opp_rating integer, pgn text);`);
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  return drizzle(c, { schema });
}

const EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";

describe("getLeakOccurrences", () => {
  it("returns the user's matching moves with game + ply, newest first", async () => {
    const db = await memDb();
    for (const [gid, end] of [["g1", 100], ["g2", 200]] as const) {
      await db.insert(schema.games).values({ id: gid, source: "chesscom", url: null, username: "me",
        myColor: "white", result: "loss", timeClass: "rapid", endTime: end, eco: "B20",
        openingName: "Sicilian Defense", myRating: 1500, oppRating: 1500, pgn: "" });
      await db.insert(schema.moves).values({ gameId: gid, ply: 2, fenBefore: "F", fenAfter: "F2",
        epdBefore: EPD, epdAfter: "E2", san: "d4", uci: "d2d4", isMine: true, bookStatus: "novelty",
        evalBestCp: 30, evalPlayedCp: -90, cpLoss: 120, classification: "mistake" });
    }
    // a non-mine move with the same key must be ignored
    await db.insert(schema.moves).values({ gameId: "g1", ply: 9, fenBefore: "F", fenAfter: "F2",
      epdBefore: EPD, epdAfter: "E2", san: "d4", uci: "d2d4", isMine: false, bookStatus: "novelty",
      evalBestCp: null, evalPlayedCp: null, cpLoss: null, classification: null });

    const occ = await getLeakOccurrences(db, EPD, "d4");
    expect(occ.map((o) => o.gameId)).toEqual(["g2", "g1"]);
    expect(occ[0]).toMatchObject({ gameId: "g2", ply: 2, result: "loss", myColor: "white",
      openingName: "Sicilian Defense" });
  });
});

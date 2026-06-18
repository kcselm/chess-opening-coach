import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getTreeChildren, START_EPD } from "./getTreeChildren.js";

const AFTER_E4_EPD = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE games (id text primary key, source text, url text, username text,
    my_color text, result text, time_class text, end_time integer, eco text, opening_name text,
    my_rating integer, opp_rating integer, pgn text);`);
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  const db = drizzle(c, { schema });
  // two WHITE games: both open 1.e4 (your move), one win one loss
  for (const [gid, result, cp] of [["g1", "win", 5], ["g2", "loss", 80]] as const) {
    await db.insert(schema.games).values({ id: gid, source: "chesscom", url: null, username: "me",
      myColor: "white", result, timeClass: "rapid", endTime: 1, eco: "B20",
      openingName: "Sicilian", myRating: 1500, oppRating: 1500, pgn: "" });
    await db.insert(schema.moves).values({ gameId: gid, ply: 1, fenBefore: "F", fenAfter: "F2",
      epdBefore: START_EPD, epdAfter: AFTER_E4_EPD, san: "e4", uci: "e2e4", isMine: true,
      bookStatus: "in_book", evalBestCp: 30, evalPlayedCp: 25, cpLoss: cp, classification: "book" });
  }
  // a BLACK game opening 1.e4 must be excluded from the white tree
  await db.insert(schema.games).values({ id: "g3", source: "chesscom", url: null, username: "me",
    myColor: "black", result: "win", timeClass: "rapid", endTime: 1, eco: "B20",
    openingName: "Sicilian", myRating: 1500, oppRating: 1500, pgn: "" });
  await db.insert(schema.moves).values({ gameId: "g3", ply: 1, fenBefore: "F", fenAfter: "F2",
    epdBefore: START_EPD, epdAfter: AFTER_E4_EPD, san: "e4", uci: "e2e4", isMine: false,
    bookStatus: "in_book", evalBestCp: null, evalPlayedCp: null, cpLoss: null, classification: null });
  return db;
}

describe("getTreeChildren", () => {
  it("aggregates your color's moves from a position with objective W/D/L", async () => {
    const db = await memDb();
    const t = await getTreeChildren(db, "white", START_EPD);
    expect(t.children).toHaveLength(1);
    const e4 = t.children[0]!;
    expect(e4).toMatchObject({ san: "e4", uci: "e2e4", epdAfter: AFTER_E4_EPD, count: 2,
      isMine: true, classification: "book", white: 1, draws: 0, black: 1 });
    expect(e4.avgCpLoss).toBeCloseTo(42.5); // (5 + 80) / 2
  });
  it("defaults to the start position and returns an empty leaf", async () => {
    const db = await memDb();
    expect((await getTreeChildren(db, "white")).children).toHaveLength(1); // default epd = START_EPD
    expect((await getTreeChildren(db, "white", "nowhere w - -")).children).toEqual([]);
  });
});

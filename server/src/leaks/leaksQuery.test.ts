import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getLeaks } from "./leaksQuery.js";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE games (id text primary key, source text, url text, username text,
    my_color text, result text, time_class text, end_time integer, eco text, opening_name text,
    my_rating integer, opp_rating integer, pgn text);`);
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  await c.execute(`CREATE TABLE position_evals (epd text, depth integer, engine_version text,
    score_cp integer, mate_in integer, lines_json text, primary key (epd, depth, engine_version));`);
  return drizzle(c, { schema });
}

describe("getLeaks", () => {
  it("groups repeated mistakes by position+move, ranked by occurrences*avgLoss", async () => {
    const db = await memDb();
    for (const [gid, result] of [["g1", "loss"], ["g2", "draw"]] as const) {
      await db.insert(schema.games).values({ id: gid, source: "chesscom", url: null, username: "me",
        myColor: "white", result, timeClass: "rapid", endTime: 1, eco: "B20",
        openingName: "Sicilian Defense", myRating: 1500, oppRating: 1500, pgn: "" });
      await db.insert(schema.moves).values({ gameId: gid, ply: 4,
        fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        fenAfter: "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1",
        epdBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
        epdAfter: "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3",
        san: "d4", uci: "d2d4",
        isMine: true, bookStatus: "novelty", evalBestCp: 30, evalPlayedCp: -90, cpLoss: 120,
        classification: "mistake" });
    }
    await db.insert(schema.positionEvals).values({ epd: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", depth: 18, engineVersion: "v",
      scoreCp: 30, mateIn: null, linesJson: JSON.stringify([{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["g1f3"] }]) });

    const leaks = await getLeaks(db, { minCpLoss: 100, depth: 18, engineVersion: "v", limit: 20 });
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({
      openingName: "Sicilian Defense", yourMoveSan: "d4", occurrences: 2, avgCpLoss: 120,
    });
    expect(leaks[0]!.scorePct).toBeCloseTo(25);
    expect(leaks[0]!.betterMoveSan).toBeTruthy();
  });
});

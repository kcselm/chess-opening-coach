import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getGameReview, whitePovCp } from "./gameReview.js";

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
  await c.execute(`CREATE TABLE book_stats (epd text, source text, total integer, moves_json text,
    fetched_at integer, primary key (epd, source));`);
  return drizzle(c, { schema });
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
const AFTER_E4_EPD = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3";

describe("whitePovCp", () => {
  it("keeps white-to-move evals and negates black-to-move evals", () => {
    expect(whitePovCp(START_EPD, { scoreCp: 30, mateIn: null })).toBe(30);
    expect(whitePovCp(AFTER_E4_EPD, { scoreCp: 30, mateIn: null })).toBe(-30);
    expect(whitePovCp(AFTER_E4_EPD, undefined)).toBeNull();
  });

  it("returns null (not throws) for a both-null eval row — white to move", () => {
    expect(whitePovCp(START_EPD, { scoreCp: null, mateIn: null })).toBeNull();
  });

  it("returns null (not throws) for a both-null eval row — black to move", () => {
    expect(whitePovCp(AFTER_E4_EPD, { scoreCp: null, mateIn: null })).toBeNull();
  });
});

describe("getGameReview", () => {
  it("returns null for an unknown game", async () => {
    const db = await memDb();
    expect(await getGameReview(db, "nope", { depth: 18, engineVersion: "v" })).toBeNull();
  });

  it("resolves (does not reject) when a position_evals row has both score_cp and mate_in NULL", async () => {
    const db = await memDb();
    await db.insert(schema.games).values({ id: "g2", source: "chesscom", url: null, username: "me",
      myColor: "white", result: "draw", timeClass: "rapid", endTime: 8, eco: "A00",
      openingName: "Unknown", myRating: 1200, oppRating: 1200, pgn: "" });
    await db.insert(schema.moves).values({ gameId: "g2", ply: 1, fenBefore: START, fenAfter: AFTER_E4,
      epdBefore: START_EPD, epdAfter: AFTER_E4_EPD, san: "e4", uci: "e2e4", isMine: true,
      bookStatus: null, evalBestCp: null, evalPlayedCp: null, cpLoss: null, classification: null });
    // Both-null row — what the orchestrator writes when the engine returns no lines
    await db.insert(schema.positionEvals).values([
      { epd: START_EPD, depth: 18, engineVersion: "v", scoreCp: null, mateIn: null, linesJson: "[]" },
      { epd: AFTER_E4_EPD, depth: 18, engineVersion: "v", scoreCp: null, mateIn: null, linesJson: "[]" },
    ]);

    const review = await getGameReview(db, "g2", { depth: 18, engineVersion: "v" });
    expect(review).not.toBeNull();
    const m = review!.moves[0]!;
    expect(m.evalBeforeWhiteCp).toBeNull();
    expect(m.evalAfterWhiteCp).toBeNull();
  });

  it("enriches each ply with white-POV evals, engine lines, book, and better move", async () => {
    const db = await memDb();
    await db.insert(schema.games).values({ id: "g1", source: "chesscom", url: null, username: "me",
      myColor: "white", result: "loss", timeClass: "rapid", endTime: 7, eco: "B20",
      openingName: "Sicilian Defense", myRating: 1500, oppRating: 1500, pgn: "" });
    await db.insert(schema.moves).values({ gameId: "g1", ply: 1, fenBefore: START, fenAfter: AFTER_E4,
      epdBefore: START_EPD, epdAfter: AFTER_E4_EPD, san: "e4", uci: "e2e4", isMine: true,
      bookStatus: "in_book", evalBestCp: 30, evalPlayedCp: 25, cpLoss: 5, classification: "book" });
    await db.insert(schema.positionEvals).values([
      { epd: START_EPD, depth: 18, engineVersion: "v", scoreCp: 30, mateIn: null,
        linesJson: JSON.stringify([{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["d2d4"] }]) },
      { epd: AFTER_E4_EPD, depth: 18, engineVersion: "v", scoreCp: 28, mateIn: null,
        linesJson: JSON.stringify([{ rank: 1, scoreCp: 28, mateIn: null, pvUci: ["c7c5"] }]) },
    ]);
    await db.insert(schema.bookStats).values({ epd: START_EPD, source: "masters", total: 200,
      movesJson: JSON.stringify([{ san: "e4", uci: "e2e4", count: 120, white: 60, draws: 40, black: 20 }]),
      fetchedAt: 0 });

    const review = await getGameReview(db, "g1", { depth: 18, engineVersion: "v" });
    expect(review).not.toBeNull();
    expect(review!.openingName).toBe("Sicilian Defense");
    expect(review!.myColor).toBe("white");
    expect(review!.moves).toHaveLength(1);
    const m = review!.moves[0]!;
    expect(m.san).toBe("e4");
    expect(m.evalBeforeWhiteCp).toBe(30);   // white to move at start
    expect(m.evalAfterWhiteCp).toBe(-28);   // black to move after e4 -> negate
    expect(m.betterMoveSan).toBe("d4");     // best PV at the start position
    expect(m.engineLines[0]!.pvUci).toEqual(["d2d4"]);
    expect(m.bookMoves).toEqual([{ san: "e4", count: 120 }]);
    expect(m.bookTotal).toBe(200);
  });
});

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { analyzePositions, type Analyzer } from "./orchestrator.js";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  await c.execute(`CREATE TABLE position_evals (epd text, depth integer, engine_version text,
    score_cp integer, mate_in integer, lines_json text, primary key (epd, depth, engine_version));`);
  return drizzle(c, { schema });
}

const fakeEngine: Analyzer = {
  version: "fake-1",
  async analyze(fen, depth) {
    return { epd: fen.split(" ").slice(0, 4).join(" "), depth, engineVersion: "fake-1",
      lines: [{ rank: 1, scoreCp: 20, mateIn: null, pvUci: ["e2e4"] }] };
  },
};

describe("analyzePositions", () => {
  it("analyzes each unique EPD once and caches it", async () => {
    const db = await memDb();
    await db.insert(schema.moves).values([
      { gameId: "g1", ply: 0, fenBefore: "A w - -", fenAfter: "B b - -",
        epdBefore: "A w - -", epdAfter: "B b - -", san: "e4", uci: "e2e4", isMine: true },
      { gameId: "g2", ply: 0, fenBefore: "A w - -", fenAfter: "B b - -",
        epdBefore: "A w - -", epdAfter: "B b - -", san: "e4", uci: "e2e4", isMine: true },
    ]);
    let calls = 0;
    const counting: Analyzer = { version: "fake-1", async analyze(f, d) { calls++; return fakeEngine.analyze(f, d, 3); } };
    const res = await analyzePositions(db, counting, { depth: 12, multipv: 3 });
    expect(calls).toBe(2);
    expect(res.analyzed).toBe(2);
    const cached = await db.select().from(schema.positionEvals);
    expect(cached).toHaveLength(2);
  });

  it("skips EPDs already cached", async () => {
    const db = await memDb();
    await db.insert(schema.moves).values([
      { gameId: "g1", ply: 0, fenBefore: "A w - -", fenAfter: "B b - -",
        epdBefore: "A w - -", epdAfter: "B b - -", san: "e4", uci: "e2e4", isMine: true },
    ]);
    await db.insert(schema.positionEvals).values({ epd: "A w - -", depth: 12, engineVersion: "fake-1",
      scoreCp: 10, mateIn: null, linesJson: "[]" });
    let calls = 0;
    const counting: Analyzer = { version: "fake-1", async analyze(f, d) { calls++; return fakeEngine.analyze(f, d, 3); } };
    await analyzePositions(db, counting, { depth: 12, multipv: 3 });
    expect(calls).toBe(1);
  });
});

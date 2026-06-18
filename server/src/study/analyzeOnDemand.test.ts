import { describe, it, expect, vi } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { analyzeOnDemand } from "./analyzeOnDemand.js";

const FEN_B = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE position_evals (epd text, depth integer, engine_version text,
    score_cp integer, mate_in integer, lines_json text, primary key (epd, depth, engine_version));`);
  return drizzle(c, { schema });
}

function fakeEngine() {
  return {
    version: "v",
    analyze: vi.fn(async (fen: string, depth: number, _mpv: number) => ({
      epd: fen.split(" ").slice(0, 4).join(" "), depth, engineVersion: "v",
      lines: [{ rank: 1, scoreCp: 28, mateIn: null, pvUci: ["c7c5"] }],
    })),
  };
}

describe("analyzeOnDemand", () => {
  it("runs the engine on a miss, caches, and returns white-POV eval", async () => {
    const db = await memDb();
    const engine = fakeEngine();
    const r = await analyzeOnDemand(db, engine, { depth: 18, multipv: 3 }, FEN_B);
    expect(engine.analyze).toHaveBeenCalledTimes(1);
    expect(r.scoreCp).toBe(28);
    expect(r.evalWhiteCp).toBe(-28); // black to move -> negate
    expect(r.lines[0]!.pvUci).toEqual(["c7c5"]);
    const cached = await db.select().from(schema.positionEvals);
    expect(cached).toHaveLength(1);
  });
  it("short-circuits on a cache hit (no second engine call)", async () => {
    const db = await memDb();
    const engine = fakeEngine();
    await analyzeOnDemand(db, engine, { depth: 18, multipv: 3 }, FEN_B);
    await analyzeOnDemand(db, engine, { depth: 18, multipv: 3 }, FEN_B);
    expect(engine.analyze).toHaveBeenCalledTimes(1);
  });
});

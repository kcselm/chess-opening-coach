import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EngineManager } from "./engineManager.js";

const RUN = process.env.RUN_ENGINE_TESTS === "1";

describe.runIf(RUN)("EngineManager (real binary)", () => {
  const engine = new EngineManager({ multipv: 3 });
  beforeAll(async () => { await engine.start(); }, 30000);
  afterAll(async () => { await engine.stop(); });

  it("finds a strong first move from the start position", async () => {
    const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const res = await engine.analyze(startFen, 14, 3);
    expect(res.lines.length).toBeGreaterThan(0);
    expect(res.lines[0]!.pvUci[0]).toMatch(/^[a-h][1-2][a-h][1-4]/);
    expect(Math.abs(res.lines[0]!.scoreCp ?? 0)).toBeLessThan(100);
  }, 30000);
});

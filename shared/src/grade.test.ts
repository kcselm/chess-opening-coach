import { describe, it, expect } from "vitest";
import { gradeDrillMove, moveCpLoss, DEFAULT_MAX_CP_LOSS } from "./grade.js";
import type { BookMoveStat, EngineLine } from "./schemas.js";

const book: BookMoveStat[] = [
  { san: "e4", uci: "e2e4", count: 100, white: 50, draws: 30, black: 20 },
  { san: "d4", uci: "d2d4", count: 60, white: 30, draws: 20, black: 10 },
];
const lines: EngineLine[] = [
  { rank: 1, scoreCp: 30, mateIn: null, pvUci: ["e2e4"] },
  { rank: 2, scoreCp: 10, mateIn: null, pvUci: ["d2d4"] },
];

describe("moveCpLoss", () => {
  it("is the clamped best-minus-played difference", () => {
    expect(moveCpLoss(30, 10)).toBe(20);
    expect(moveCpLoss(30, 40)).toBe(0); // never negative
  });
});

describe("gradeDrillMove", () => {
  it("passes an in-book best move (cpLoss 0)", () => {
    const r = gradeDrillMove({ playedUci: "e2e4", bookMoves: book, lines, playedEvalCp: null, maxCpLoss: 50 });
    expect(r).toEqual({ inBook: true, cpLoss: 0, pass: true });
  });
  it("fails an in-book move that loses more than the threshold (cpLoss from multiPV)", () => {
    const r = gradeDrillMove({ playedUci: "d2d4", bookMoves: book, lines, playedEvalCp: null, maxCpLoss: 10 });
    expect(r.cpLoss).toBe(20);
    expect(r.pass).toBe(false);
  });
  it("fails an off-book move even when its eval is fine", () => {
    // a2a4 is not in book; its after-eval gives playedEvalCp 20 → cpLoss 10 (≤ threshold) but out of book
    const r = gradeDrillMove({ playedUci: "a2a4", bookMoves: book, lines, playedEvalCp: 20, maxCpLoss: 50 });
    expect(r).toEqual({ inBook: false, cpLoss: 10, pass: false });
  });
  it("uses playedEvalCp when the move is not in the multiPV", () => {
    const r = gradeDrillMove({ playedUci: "g1f3", bookMoves: [...book, { san: "Nf3", uci: "g1f3", count: 40, white: 20, draws: 12, black: 8 }],
      lines, playedEvalCp: -5, maxCpLoss: 50 });
    expect(r.cpLoss).toBe(35); // 30 - (-5)
    expect(r.pass).toBe(true); // in book and within threshold
  });
  it("grades engine-only when book is unknown (null)", () => {
    const r = gradeDrillMove({ playedUci: "d2d4", bookMoves: null, lines, playedEvalCp: null, maxCpLoss: 50 });
    expect(r.inBook).toBe(false);
    expect(r.cpLoss).toBe(20);
    expect(r.pass).toBe(true); // passes on cpLoss alone because book is unknown
  });
  it("returns cpLoss null (ungradable) when no eval is available", () => {
    const r = gradeDrillMove({ playedUci: "h2h4", bookMoves: book, lines: [], playedEvalCp: null, maxCpLoss: 50 });
    expect(r.cpLoss).toBeNull();
    expect(r.pass).toBe(false);
  });
  it("exports a default threshold of 50", () => {
    expect(DEFAULT_MAX_CP_LOSS).toBe(50);
  });
});

import { describe, it, expect } from "vitest";
import { classifyMove, DEFAULT_THRESHOLDS } from "./classifier.js";
import { gradeDrillMove, moveCpLoss } from "@coc/shared";

describe("classifyMove", () => {
  const book = { moves: [{ san: "e6", uci: "e7e6" }, { san: "e5", uci: "e7e5" }] };

  it("computes cpLoss from bestCp(before) + bestCp(after)", () => {
    const r = classifyMove({ playedSan: "e6", bestCpBefore: 30, bestCpAfter: 10,
      book, thresholds: DEFAULT_THRESHOLDS });
    expect(r.cpLoss).toBe(40);
  });

  it("labels by threshold and clamps negative loss to 0", () => {
    expect(classifyMove({ playedSan: "e5", bestCpBefore: 20, bestCpAfter: -25, book,
      thresholds: DEFAULT_THRESHOLDS }).classification).toBe("best");
    expect(classifyMove({ playedSan: "e5", bestCpBefore: 30, bestCpAfter: 40, book,
      thresholds: DEFAULT_THRESHOLDS }).classification).toBe("inaccuracy");
    expect(classifyMove({ playedSan: "e5", bestCpBefore: 30, bestCpAfter: 90, book,
      thresholds: DEFAULT_THRESHOLDS }).classification).toBe("mistake");
    expect(classifyMove({ playedSan: "e5", bestCpBefore: 100, bestCpAfter: 150, book,
      thresholds: DEFAULT_THRESHOLDS }).classification).toBe("blunder");
  });

  it("derives book status from the reference moves", () => {
    expect(classifyMove({ playedSan: "e6", bestCpBefore: 0, bestCpAfter: 0, book,
      thresholds: DEFAULT_THRESHOLDS }).bookStatus).toBe("in_book");
    expect(classifyMove({ playedSan: "Na6", bestCpBefore: 0, bestCpAfter: 0, book,
      thresholds: DEFAULT_THRESHOLDS }).bookStatus).toBe("novelty");
    expect(classifyMove({ playedSan: "e6", bestCpBefore: 0, bestCpAfter: 0, book: null,
      thresholds: DEFAULT_THRESHOLDS }).bookStatus).toBe("unknown");
  });
});

describe("classifier ⇄ shared grade parity", () => {
  it("computes the same cpLoss as moveCpLoss / gradeDrillMove", () => {
    // classifier inputs: bestCpBefore 30, bestCpAfter 10 → evalPlayedCp = -10, cpLoss = 30 - (-10) = 40
    const c = classifyMove({ playedSan: "e6", bestCpBefore: 30, bestCpAfter: 10,
      book: { moves: [{ san: "e6", uci: "e7e6" }] }, thresholds: DEFAULT_THRESHOLDS });
    expect(c.cpLoss).toBe(moveCpLoss(30, -10));

    // the drill grader, given the same position-before lines and the move's after-eval, agrees
    const g = gradeDrillMove({ playedUci: "e7e6",
      bookMoves: [{ san: "e6", uci: "e7e6", count: 1, white: 0, draws: 0, black: 1 }],
      lines: [{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["d2d4"] }],
      playedEvalCp: -10, maxCpLoss: 50 });
    expect(g.cpLoss).toBe(c.cpLoss);
  });
});

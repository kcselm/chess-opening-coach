import { describe, it, expect } from "vitest";
import { classifyMove, DEFAULT_THRESHOLDS } from "./classifier.js";

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

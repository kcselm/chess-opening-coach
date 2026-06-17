import { describe, it, expect } from "vitest";
import { bestMoveSan } from "./bestMove.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("bestMoveSan", () => {
  it("derives SAN from the first PV move", () => {
    expect(bestMoveSan(START, [{ pvUci: ["g1f3"] }])).toBe("Nf3");
  });
  it("returns null when there is no line", () => {
    expect(bestMoveSan(START, [])).toBeNull();
  });
  it("returns null for an illegal/garbage uci", () => {
    expect(bestMoveSan(START, [{ pvUci: ["z9z9"] }])).toBeNull();
  });
});

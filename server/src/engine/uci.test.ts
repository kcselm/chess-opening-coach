import { describe, it, expect } from "vitest";
import { parseInfoLine, parseBestMove } from "./uci.js";

describe("parseInfoLine", () => {
  it("parses a cp score with multipv and pv", () => {
    const line =
      "info depth 18 seldepth 24 multipv 1 score cp 34 nodes 1000 pv e2e4 e7e5 g1f3";
    expect(parseInfoLine(line)).toEqual({
      depth: 18, rank: 1, scoreCp: 34, mateIn: null, pvUci: ["e2e4", "e7e5", "g1f3"],
    });
  });
  it("parses a mate score", () => {
    const line = "info depth 20 multipv 2 score mate -3 pv d1h5 e8e7";
    expect(parseInfoLine(line)).toEqual({
      depth: 20, rank: 2, scoreCp: null, mateIn: -3, pvUci: ["d1h5", "e8e7"],
    });
  });
  it("returns null for non-info lines", () => {
    expect(parseInfoLine("readyok")).toBeNull();
    expect(parseInfoLine("info string NNUE evaluation using ...")).toBeNull();
  });
});

describe("parseBestMove", () => {
  it("extracts the best move", () => {
    expect(parseBestMove("bestmove e2e4 ponder e7e5")).toBe("e2e4");
  });
  it("returns null when absent", () => {
    expect(parseBestMove("info depth 1")).toBeNull();
  });
});

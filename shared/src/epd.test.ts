import { describe, it, expect } from "vitest";
import { toEpd, scoreToCp } from "./epd.js";

describe("toEpd", () => {
  it("drops the halfmove and fullmove clocks", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    expect(toEpd(fen)).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3");
  });
  it("keeps the en-passant dash when there is no en-passant square", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(toEpd(fen)).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
  });
});

describe("scoreToCp", () => {
  it("returns cp directly when not mate", () => {
    expect(scoreToCp({ scoreCp: 35, mateIn: null })).toBe(35);
  });
  it("maps positive mate to a large positive cp by distance", () => {
    expect(scoreToCp({ scoreCp: null, mateIn: 3 })).toBe(100000 - 3);
  });
  it("maps negative mate to a large negative cp", () => {
    expect(scoreToCp({ scoreCp: null, mateIn: -2 })).toBe(-(100000 - 2));
  });
  it("throws when neither cp nor mate is provided", () => {
    expect(() => scoreToCp({ scoreCp: null, mateIn: null })).toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { pickOpening } from "./namer.js";

const table = new Map<string, { eco: string; name: string }>([
  ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3", { eco: "B00", name: "King's Pawn" }],
  ["rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6", { eco: "B20", name: "Sicilian Defense" }],
]);

describe("pickOpening", () => {
  it("returns the deepest matching opening the game passed through", () => {
    const epdsInOrder = [
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3",
      "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6",
    ];
    expect(pickOpening(epdsInOrder, table)).toEqual({ eco: "B20", name: "Sicilian Defense" });
  });
  it("returns null when nothing matches", () => {
    expect(pickOpening(["unknown w - -"], table)).toBeNull();
  });
});

import { rowToEpd } from "./seed.js";

describe("rowToEpd", () => {
  it("converts an opening pgn to its final EPD", () => {
    // chess.js v1 clears the e.p. square after each half-move, so after 1.e4 c5
    // it is white's turn and c6 is no longer a valid e.p. target → "-"
    expect(rowToEpd("1. e4 c5")).toBe("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -");
  });
});

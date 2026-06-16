import { describe, it, expect } from "vitest";
import { extractOpeningMoves } from "./pgn.js";

describe("extractOpeningMoves", () => {
  const pgn = "[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0";

  it("returns one record per ply with fen/san/uci and isMine", () => {
    const moves = extractOpeningMoves(pgn, "white", 30);
    expect(moves).toHaveLength(4);
    expect(moves[0]).toMatchObject({ ply: 0, san: "e4", uci: "e2e4", isMine: true });
    expect(moves[1]).toMatchObject({ ply: 1, san: "e5", uci: "e7e5", isMine: false });
    expect(moves[2]).toMatchObject({ ply: 2, san: "Nf3", isMine: true });
  });

  it("computes fenBefore/fenAfter consistently (after of ply k == before of ply k+1)", () => {
    const moves = extractOpeningMoves(pgn, "white", 30);
    expect(moves[0]!.fenAfter).toBe(moves[1]!.fenBefore);
  });

  it("caps at maxPlies", () => {
    expect(extractOpeningMoves(pgn, "white", 2)).toHaveLength(2);
  });
});

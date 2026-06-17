import { describe, it, expect } from "vitest";
import { GameSummary, GameReview, LeakOccurrence, ReviewMove } from "./schemas.js";

describe("phase-2 schemas", () => {
  it("parses a GameSummary", () => {
    const v = {
      id: "g1", source: "chesscom", openingName: "Sicilian Defense", eco: "B20",
      myColor: "white", result: "loss", timeClass: "rapid", endTime: 1,
      myRating: 1500, oppRating: 1490,
    };
    expect(GameSummary.parse(v)).toEqual(v);
  });

  it("parses a ReviewMove with nullable evals and engine lines", () => {
    const v = {
      ply: 1, san: "e4", uci: "e2e4", isMine: true,
      fenBefore: "F0", fenAfter: "F1", bookStatus: "in_book", classification: "book",
      cpLoss: 0, evalBeforeWhiteCp: 20, evalAfterWhiteCp: 25,
      engineLines: [{ rank: 1, scoreCp: 25, mateIn: null, pvUci: ["e2e4"] }],
      betterMoveSan: "e4", bookMoves: [{ san: "e4", count: 100 }], bookTotal: 120,
    };
    expect(ReviewMove.parse(v)).toEqual(v);
    expect(ReviewMove.parse({ ...v, evalBeforeWhiteCp: null, classification: null }).evalBeforeWhiteCp).toBeNull();
  });

  it("parses GameReview and LeakOccurrence", () => {
    const review = {
      id: "g1", source: "chesscom", openingName: null, eco: null, myColor: "black",
      result: "win", timeClass: "blitz", endTime: 2, myRating: null, oppRating: null, moves: [],
    };
    expect(GameReview.parse(review).moves).toEqual([]);
    const occ = { gameId: "g1", ply: 4, result: "loss", endTime: 9, openingName: "X", myColor: "white" };
    expect(LeakOccurrence.parse(occ)).toEqual(occ);
  });
});

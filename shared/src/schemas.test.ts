import { describe, it, expect } from "vitest";
import { GameSummary, GameReview, LeakOccurrence, ReviewMove } from "./schemas.js";
import { BookSource, OpeningListItem, ExploreResult, PositionAnalysis, TreeChild, TreeChildren } from "./schemas.js";

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

describe("phase-3 schemas", () => {
  it("parses an ExploreResult with nullable eval", () => {
    const v = {
      epd: "E", source: "masters", total: 200,
      bookMoves: [{ san: "e4", uci: "e2e4", count: 120, white: 60, draws: 40, black: 20 }],
      evalWhiteCp: 25, lines: [{ rank: 1, scoreCp: 25, mateIn: null, pvUci: ["e2e4"] }],
    };
    expect(ExploreResult.parse(v)).toEqual(v);
    expect(ExploreResult.parse({ ...v, evalWhiteCp: null }).evalWhiteCp).toBeNull();
    expect(BookSource.parse("rating")).toBe("rating");
  });

  it("parses a PositionAnalysis and an OpeningListItem", () => {
    const pa = { epd: "E", evalWhiteCp: -30, scoreCp: 30, mateIn: null,
      lines: [{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["d2d4"] }], depth: 18, engineVersion: "v" };
    expect(PositionAnalysis.parse(pa)).toEqual(pa);
    expect(OpeningListItem.parse({ epd: "E", eco: "B20", name: "Sicilian" }).name).toBe("Sicilian");
  });

  it("parses TreeChildren with nullable classification/avgCpLoss", () => {
    const child = { san: "e4", uci: "e2e4", epdAfter: "E2", count: 3, isMine: true,
      classification: "book", avgCpLoss: 12.5, white: 2, draws: 0, black: 1 };
    expect(TreeChild.parse(child)).toEqual(child);
    expect(TreeChild.parse({ ...child, classification: null, avgCpLoss: null }).avgCpLoss).toBeNull();
    const tc = { epd: "E", color: "white", children: [child] };
    expect(TreeChildren.parse(tc).children).toHaveLength(1);
  });
});

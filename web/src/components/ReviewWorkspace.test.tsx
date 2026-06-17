import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { GameReview, ReviewMove } from "@coc/shared";

vi.mock("./Chessboard.js", () => ({ Chessboard: ({ fen }: { fen: string }) => <div data-testid="board" data-fen={fen} /> }));

import { ReviewWorkspace } from "./ReviewWorkspace.js";

const mv = (over: Partial<ReviewMove>): ReviewMove => ({
  ply: 1, san: "e4", uci: "e2e4", isMine: true, fenBefore: "START", fenAfter: "AFTER1",
  bookStatus: "book" as never, classification: "book", cpLoss: 0,
  evalBeforeWhiteCp: 20, evalAfterWhiteCp: 25, engineLines: [], betterMoveSan: "e4",
  bookMoves: [], bookTotal: 0, ...over,
});
const review: GameReview = {
  id: "g1", source: "chesscom", openingName: "Sicilian", eco: "B20", myColor: "white",
  result: "loss", timeClass: "rapid", endTime: 1, myRating: 1500, oppRating: 1500,
  moves: [mv({ ply: 1, fenBefore: "START", fenAfter: "AFTER1" }),
          mv({ ply: 2, san: "c5", isMine: false, fenBefore: "AFTER1", fenAfter: "AFTER2" })],
};

describe("ReviewWorkspace", () => {
  it("starts at the position, then steps forward with ArrowRight", () => {
    render(<ReviewWorkspace review={review} />);
    expect(screen.getByTestId("ply-indicator")).toHaveTextContent("0/2");
    expect(screen.getByTestId("board")).toHaveAttribute("data-fen", "START");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("ply-indicator")).toHaveTextContent("1/2");
    expect(screen.getByTestId("board")).toHaveAttribute("data-fen", "AFTER1");
  });
  it("seeds the selected ply from initialPly", () => {
    render(<ReviewWorkspace review={review} initialPly={2} />);
    expect(screen.getByTestId("ply-indicator")).toHaveTextContent("2/2");
    expect(screen.getByTestId("board")).toHaveAttribute("data-fen", "AFTER2");
  });
});

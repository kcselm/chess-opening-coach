import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReviewMove } from "@coc/shared";
import { MoveList } from "./MoveList.js";

const mv = (over: Partial<ReviewMove>): ReviewMove => ({
  ply: 1, san: "e4", uci: "e2e4", isMine: true, fenBefore: "F0", fenAfter: "F1",
  bookStatus: "book" as never, classification: "book", cpLoss: 0,
  evalBeforeWhiteCp: 20, evalAfterWhiteCp: 25, engineLines: [], betterMoveSan: "e4",
  bookMoves: [], bookTotal: 0, ...over,
});

const moves: ReviewMove[] = [
  mv({ ply: 1, san: "e4", isMine: true, classification: "book" }),
  mv({ ply: 2, san: "c5", isMine: false, classification: null }),
  mv({ ply: 3, san: "d4", isMine: true, classification: "mistake" }),
];

describe("MoveList", () => {
  it("shows chips on the user's moves and calls onSelect with the 1-based index", () => {
    const onSelect = vi.fn();
    render(<MoveList moves={moves} selected={1} onSelect={onSelect} />);
    expect(screen.getByText("e4")).toBeInTheDocument();
    expect(screen.getByText("mistake")).toBeInTheDocument(); // chip on the d4 blunder/mistake
    fireEvent.click(screen.getByTestId("move-2"));
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReviewMove } from "@coc/shared";
import { PositionPanel } from "./PositionPanel.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const move: ReviewMove = {
  ply: 1, san: "e4", uci: "e2e4", isMine: true, fenBefore: START, fenAfter: "F1",
  bookStatus: "novelty", classification: "mistake", cpLoss: 120,
  evalBeforeWhiteCp: 30, evalAfterWhiteCp: -90,
  engineLines: [
    { rank: 1, scoreCp: 30, mateIn: null, pvUci: ["d2d4"] },
    { rank: 2, scoreCp: 10, mateIn: null, pvUci: ["g1f3"] },
  ],
  betterMoveSan: "d4", bookMoves: [{ san: "e4", count: 120 }], bookTotal: 200,
};

describe("PositionPanel", () => {
  it("shows the engine's SAN lines, the better move, and book counts", () => {
    render(<PositionPanel move={move} />);
    // "Nf3" comes only from firstSan(g1f3) in the engine list — verifies SAN derivation uniquely.
    expect(screen.getByText("Nf3")).toBeInTheDocument();
    expect(screen.getByText(/Engine prefers/)).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument(); // book move count, unique on the page
  });
});

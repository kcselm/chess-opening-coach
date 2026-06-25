import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DrillApi } from "../hooks/useDrill.js";

vi.mock("./Chessboard.js", () => ({
  Chessboard: ({ fen, orientation }: { fen: string; orientation?: string }) =>
    <div data-testid="board" data-fen={fen} data-orientation={orientation} />,
}));
vi.mock("./EvalBar.js", () => ({ EvalBar: () => <div data-testid="evalbar" /> }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: unknown; to: string }) =>
    <a href={to}>{children as any}</a>,
}));

import { DrillWorkspace } from "./DrillWorkspace.js";

const base: DrillApi = {
  status: "playing", fen: "8/8/8/8/8/8/8/8 b - -", movableColor: "black", dests: new Map(),
  bookMoves: [{ san: "e6", uci: "e7e6", count: 61, white: 30, draws: 20, black: 11 },
    { san: "Nf6", uci: "g8f6", count: 22, white: 10, draws: 7, black: 5 }],
  evalWhiteCp: 15, lineSan: ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4"], feedback: null,
  correct: 3, total: 4, missed: [], playMove: vi.fn(async () => {}), restart: vi.fn(),
};

describe("DrillWorkspace", () => {
  it("orients the board to the drilled color and shows accuracy + theory", () => {
    render(<DrillWorkspace drill={base} color="black" onAgain={() => {}} onBack={() => {}} />);
    expect(screen.getByTestId("board").getAttribute("data-orientation")).toBe("black");
    expect(screen.getByText("3/4")).toBeInTheDocument();
    expect(screen.getByText("e6")).toBeInTheDocument(); // book theory stays visible
  });

  it("shows the better-move hint while keeping theory visible on a miss", () => {
    render(<DrillWorkspace drill={{ ...base, feedback: { betterSans: ["e6", "Nf6"] } }} color="black" onAgain={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/Better:/)).toHaveTextContent("Better: e6 / Nf6");
    expect(screen.getByText("e6")).toBeInTheDocument(); // theory table stays visible during a miss (layout C)
  });

  it("shows the completion summary with Drill again / Back when done", () => {
    const onAgain = vi.fn(), onBack = vi.fn();
    render(<DrillWorkspace drill={{ ...base, status: "done", movableColor: undefined,
      missed: [{ epd: "X w - -", betterSan: "e6" }] }} color="black" onAgain={onAgain} onBack={onBack} />);
    fireEvent.click(screen.getByText("Drill again"));
    fireEvent.click(screen.getByText("Back to recommendations"));
    expect(onAgain).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });
});

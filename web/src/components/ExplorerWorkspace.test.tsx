import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ExplorerRow } from "./ExplorerMoveTable.js";

vi.mock("./Chessboard.js", () => ({
  Chessboard: ({ fen, onMove }: { fen: string; onMove?: (o: string, d: string) => void }) => (
    <div data-testid="board" data-fen={fen}>
      {onMove && <button data-testid="free-move" onClick={() => onMove("e2", "e4")}>m</button>}
    </div>
  ),
}));

import { ExplorerWorkspace } from "./ExplorerWorkspace.js";

const rows: ExplorerRow[] = [{ san: "e4", uci: "e2e4", count: 3, white: 2, draws: 0, black: 1 }];

describe("ExplorerWorkspace", () => {
  it("renders board/rows/breadcrumb/slots and reports selections + free moves", () => {
    const onSelectMove = vi.fn(), onNavigate = vi.fn(), onReset = vi.fn(), onPlayMove = vi.fn();
    render(<ExplorerWorkspace fen="FEN" evalWhiteCp={20} rows={rows} path={["d4", "Nf6"]}
      onSelectMove={onSelectMove} onNavigate={onNavigate} onReset={onReset}
      allowFreeMove onPlayMove={onPlayMove} controls={<span>ctrl</span>} detail={<span>det</span>} />);
    expect(screen.getByTestId("board")).toHaveAttribute("data-fen", "FEN");
    expect(screen.getByText("e4")).toBeInTheDocument();
    expect(screen.getByText("ctrl")).toBeInTheDocument();
    expect(screen.getByText("det")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-row-e2e4"));
    expect(onSelectMove).toHaveBeenCalledWith("e2e4");
    fireEvent.click(screen.getByTestId("crumb-1"));
    expect(onNavigate).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTestId("free-move"));
    expect(onPlayMove).toHaveBeenCalledWith("e2", "e4");
  });
});

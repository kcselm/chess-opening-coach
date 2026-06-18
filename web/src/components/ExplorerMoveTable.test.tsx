import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExplorerMoveTable, type ExplorerRow } from "./ExplorerMoveTable.js";

const rows: ExplorerRow[] = [
  { san: "e4", uci: "e2e4", count: 5, white: 3, draws: 1, black: 1, isMine: true, classification: "book", avgCpLoss: 5 },
  { san: "d4", uci: "d2d4", count: 2, white: 1, draws: 0, black: 1 },
];

describe("ExplorerMoveTable", () => {
  it("renders rows with chips and reports clicks by uci", () => {
    const onSelect = vi.fn();
    render(<ExplorerMoveTable rows={rows} onSelect={onSelect} />);
    expect(screen.getByText("e4")).toBeInTheDocument();
    expect(screen.getByText("book")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-row-d2d4"));
    expect(onSelect).toHaveBeenCalledWith("d2d4");
  });
  it("shows an empty state", () => {
    render(<ExplorerMoveTable rows={[]} onSelect={() => {}} />);
    expect(screen.getByText(/No moves/)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { GameSummary } from "@coc/shared";
import { GamesTable } from "./GamesTable.js";

const g = (over: Partial<GameSummary>): GameSummary => ({
  id: "g1", source: "chesscom", openingName: "Sicilian Defense", eco: "B20", myColor: "white",
  result: "loss", timeClass: "rapid", endTime: 1, myRating: 1500, oppRating: 1500, ...over,
});
const games: GameSummary[] = [
  g({ id: "g1", openingName: "Sicilian Defense", result: "loss", endTime: 10 }),
  g({ id: "g2", openingName: "Italian Game", result: "win", endTime: 20, myColor: "black" }),
];

describe("GamesTable", () => {
  it("filters by result and opens a row", () => {
    const onOpen = vi.fn();
    render(<GamesTable games={games} onOpen={onOpen} />);
    expect(screen.getByText("Italian Game")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("result filter"), { target: { value: "win" } });
    expect(screen.queryByText("Sicilian Defense")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Italian Game"));
    expect(onOpen).toHaveBeenCalledWith("g2");
  });

  it("filters by opening search text", () => {
    render(<GamesTable games={games} onOpen={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("opening"), { target: { value: "sicil" } });
    expect(screen.getByText("Sicilian Defense")).toBeInTheDocument();
    expect(screen.queryByText("Italian Game")).not.toBeInTheDocument();
  });
});

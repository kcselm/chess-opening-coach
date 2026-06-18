import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ExploreResult, PositionAnalysis } from "@coc/shared";

const EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const explore: ExploreResult = { epd: EPD, source: "masters", total: 200,
  bookMoves: [{ san: "e4", uci: "e2e4", count: 120, white: 60, draws: 40, black: 20 }],
  evalWhiteCp: 20, lines: [] };
const analysis: PositionAnalysis = { epd: EPD, evalWhiteCp: 20, scoreCp: 20, mateIn: null, lines: [], depth: 18, engineVersion: "v" };

vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({ epd: EPD, source: "masters" }) }));
vi.mock("../components/Chessboard.js", () => ({ Chessboard: ({ fen }: { fen: string }) => <div data-testid="board" data-fen={fen} /> }));
const positionGet = vi.fn(async () => ({ status: 200, json: async () => analysis }));
vi.mock("../api/client.js", () => ({
  api: {
    explore: { $get: vi.fn(async () => ({ json: async () => explore })) },
    position: { $get: (..._a: unknown[]) => positionGet() },
    openings: { $get: vi.fn(async () => ({ json: async () => [] })) },
  },
}));

async function renderPage() {
  const { StudyPage } = await import("./study.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><StudyPage /></QueryClientProvider>);
}

describe("StudyPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("loads explore for the deep-linked position and Analyze calls /position", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("e4")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Analyze"));
    await waitFor(() => expect(positionGet).toHaveBeenCalled());
  });
});

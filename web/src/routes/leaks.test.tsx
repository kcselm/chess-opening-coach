import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Leak } from "@coc/shared";

// chessground manipulates real DOM/measures layout; stub the board so the test stays on the data/UX.
vi.mock("../components/Chessboard.js", () => ({ Chessboard: () => null }));

vi.mock("../api/client.js", () => ({
  api: { leaks: { $get: vi.fn(async () => ({ json: async () => leaks })) } },
}));

const leaks: Leak[] = [{
  openingName: "Sicilian Defense", eco: "B20", fenBefore: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2",
  lineSan: "", yourMoveSan: "d4", betterMoveSan: "Nf3", occurrences: 5, avgCpLoss: 95, scorePct: 40, bookStatus: "novelty",
}];

async function renderPage() {
  const { LeaksPage } = await import("./leaks.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><LeaksPage /></QueryClientProvider>);
}

describe("LeaksPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders a ranked row and expands detail on click", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Sicilian Defense")).toBeInTheDocument());
    expect(screen.getByText("d4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Sicilian Defense"));
    await waitFor(() => expect(screen.getByTestId("leak-detail")).toBeInTheDocument());
  });
});

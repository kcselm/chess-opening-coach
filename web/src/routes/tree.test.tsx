import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TreeChildren } from "@coc/shared";

const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const root: TreeChildren = { epd: START_EPD, color: "white",
  children: [{ san: "e4", uci: "e2e4", epdAfter: "AFTER", count: 3, isMine: true,
    classification: "book", avgCpLoss: 10, white: 2, draws: 0, black: 1 }] };

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search }: { children: React.ReactNode; search: { epd: string } }) =>
    <a data-testid="study-link" data-epd={search.epd}>{children}</a>,
}));
vi.mock("../components/Chessboard.js", () => ({ Chessboard: ({ fen }: { fen: string }) => <div data-testid="board" data-fen={fen} /> }));
const treeGet = vi.fn(async () => ({ json: async () => root }));
vi.mock("../api/client.js", () => ({ api: { tree: { $get: (...a: unknown[]) => treeGet(...(a as [])) } } }));

async function renderPage() {
  const { TreePage } = await import("./tree.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><TreePage /></QueryClientProvider>);
}

describe("TreePage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("lists your moves from the start and deep-links the current position to Study", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("e4")).toBeInTheDocument());
    expect(screen.getByTestId("study-link")).toHaveAttribute("data-epd", START_EPD);
  });
});

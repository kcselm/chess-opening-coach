import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DrillRecommendation } from "@coc/shared";

const recs: DrillRecommendation[] = [
  { openingEpd: "R w - -", openingName: "Caro-Kann", eco: "B10", reason: "leak", score: 360, lastDrilled: null },
];

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("../api/client.js", () => ({
  api: { drill: { recommended: { $get: vi.fn(async () => ({ json: async () => recs })) } },
    openings: { $get: vi.fn(async () => ({ json: async () => [] })) } },
}));
// stub the loop so the route test is isolated from board/engine behavior
vi.mock("../hooks/useDrill.js", () => ({
  useDrill: () => ({ status: "playing", fen: "8/8/8/8/8/8/8/8 w - -", movableColor: "white",
    dests: new Map(), bookMoves: [], evalWhiteCp: 0, lineSan: [], feedback: null,
    correct: 0, total: 0, missed: [], playMove: vi.fn(), restart: vi.fn() }),
}));
vi.mock("../components/DrillWorkspace.js", () => ({ DrillWorkspace: () => <div data-testid="workspace" /> }));

async function renderPage() {
  const { DrillPage } = await import("./drill.js");
  render(<QueryClientProvider client={new QueryClient()}><DrillPage /></QueryClientProvider>);
}

describe("DrillPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("lists recommendations and starts a drill when one is clicked", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText(/Caro-Kann/)).toBeInTheDocument());
    expect(screen.getByText("leak")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Caro-Kann/));
    await waitFor(() => expect(screen.getByTestId("workspace")).toBeInTheDocument());
  });
});

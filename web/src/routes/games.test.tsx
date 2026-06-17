import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GameSummary } from "@coc/shared";

const games: GameSummary[] = [{ id: "g1", source: "chesscom", openingName: "Sicilian Defense", eco: "B20",
  myColor: "white", result: "loss", timeClass: "rapid", endTime: 1, myRating: 1500, oppRating: 1500 }];

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../api/client.js", () => ({
  api: { games: { $get: vi.fn(async () => ({ json: async () => games })) } },
}));

async function renderPage() {
  const { GamesPage } = await import("./games.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><GamesPage /></QueryClientProvider>);
}

describe("GamesPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("lists games from the api", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Sicilian Defense")).toBeInTheDocument());
  });
});

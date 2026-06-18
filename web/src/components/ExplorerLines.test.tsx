import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Leak, LeakOccurrence } from "@coc/shared";

vi.mock("./Chessboard.js", () => ({ Chessboard: () => null }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params, search }: any) =>
    <a data-testid={to === "/study" ? "study-link" : "occ-link"}
       data-id={params?.id} data-ply={search?.ply} data-epd={search?.epd}>{children}</a>,
}));
const occ: LeakOccurrence[] = [{ gameId: "g7", ply: 4, result: "loss", endTime: 1,
  openingName: "Sicilian Defense", myColor: "white" }];
vi.mock("../api/client.js", () => ({
  api: { leaks: { occurrences: { $get: vi.fn(async () => ({ json: async () => occ })) } } },
}));

const leak: Leak = { openingName: "Sicilian Defense", eco: "B20",
  fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", lineSan: "",
  yourMoveSan: "d4", betterMoveSan: "Nf3", occurrences: 1, avgCpLoss: 120, scorePct: 0, bookStatus: "novelty" };

async function renderDetail() {
  const { LeakDetail } = await import("./ExplorerLines.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><LeakDetail leak={leak} /></QueryClientProvider>);
}

describe("LeakDetail occurrences", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders a deep-link to the game at the offending ply", async () => {
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId("occ-link")).toBeInTheDocument());
    const link = screen.getByTestId("occ-link");
    expect(link).toHaveAttribute("data-id", "g7");
    expect(link).toHaveAttribute("data-ply", "4");
    expect(screen.getByTestId("study-link"))
      .toHaveAttribute("data-epd", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
  });
});

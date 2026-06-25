import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ExploreResult, PositionAnalysis } from "@coc/shared";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3";
const AFTER_C5 = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6";

const exp = (epd: string, book: ExploreResult["bookMoves"], lines: ExploreResult["lines"]): ExploreResult =>
  ({ epd, source: "rating", total: book.reduce((s, b) => s + b.count, 0), bookMoves: book, evalWhiteCp: 20, lines });

const fixtures: Record<string, ExploreResult> = {
  [START]: exp(START, [{ san: "e4", uci: "e2e4", count: 100, white: 50, draws: 30, black: 20 }],
    [{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["e2e4"] }]),
  [AFTER_E4]: exp(AFTER_E4, [{ san: "c5", uci: "c7c5", count: 100, white: 40, draws: 30, black: 30 }],
    [{ rank: 1, scoreCp: -20, mateIn: null, pvUci: ["c7c5"] }]),
  [AFTER_C5]: exp(AFTER_C5, [], []), // out of book → line ends
};

const exploreGet = vi.fn(async ({ query }: { query: { epd: string } }) =>
  ({ status: 200, json: async () => fixtures[query.epd] ?? exp(query.epd, [], []) }));
const positionGet = vi.fn(async ({ query }: { query: { fen: string } }): Promise<{ status: number; json: () => Promise<PositionAnalysis> }> =>
  ({ status: 200, json: async () => ({ epd: "x", evalWhiteCp: -20, scoreCp: 20, mateIn: null,
    lines: [{ rank: 1, scoreCp: 20, mateIn: null, pvUci: ["a7a6"] }], depth: 18, engineVersion: "v" }) }));
const resultsPost = vi.fn(async () => ({ ok: true, json: async () => ({ saved: 1 }) }));

vi.mock("../api/client.js", () => ({
  api: {
    explore: { $get: (a: unknown) => exploreGet(a as { query: { epd: string } }) },
    position: { $get: (a: unknown) => positionGet(a as { query: { fen: string } }) },
    drill: { results: { $post: (a: unknown) => resultsPost(a as unknown) }, recommended: { $get: vi.fn() } },
  },
}));

async function mountDrill(over: Partial<Parameters<typeof import("./useDrill.js")["useDrill"]>[0]> = {}) {
  const { useDrill } = await import("./useDrill.js");
  return renderHook(() => useDrill({ rootEpd: START, color: "white", source: "rating",
    maxCpLoss: 50, openingName: "King's Pawn", seed: 1, oppDelayMs: 0, ...over }));
}

describe("useDrill", () => {
  beforeEach(() => vi.clearAllMocks());

  it("plays a passing line to its out-of-book end and posts results", async () => {
    const { result } = await mountDrill();
    await waitFor(() => expect(result.current.status).toBe("playing"));
    expect(result.current.movableColor).toBe("white");

    await act(async () => { await result.current.playMove("e2", "e4"); });
    await waitFor(() => expect(result.current.status).toBe("done"));

    expect(result.current.correct).toBe(1);
    expect(result.current.total).toBe(1);
    expect(resultsPost).toHaveBeenCalledTimes(1);
    const posted = resultsPost.mock.calls[0]![0] as { json: { attempts: unknown[] } };
    expect(posted.json.attempts).toHaveLength(1);
  }, 15000);

  it("flags an off-book move, records the first-try miss, and waits for a retry", async () => {
    const { result } = await mountDrill();
    await waitFor(() => expect(result.current.status).toBe("playing"));

    await act(async () => { await result.current.playMove("a2", "a4"); }); // not in book
    expect(result.current.status).toBe("playing");           // not advanced
    expect(result.current.movableColor).toBe("white");       // board still the user's
    expect(result.current.feedback?.betterSans).toContain("e4");
    expect(result.current.missed.some((m) => m.epd === START)).toBe(true);

    // retry with the book move → advances
    await act(async () => { await result.current.playMove("e2", "e4"); });
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.total).toBe(1);     // only the first-try (failed) attempt was recorded
    expect(result.current.correct).toBe(0);
  }, 15000);
});

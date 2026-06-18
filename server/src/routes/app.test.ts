import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { RunStore } from "../runStore.js";
import { GameSummary, GameReview, LeakOccurrence, ExploreResult, PositionAnalysis, TreeChildren, OpeningListItem } from "@coc/shared";

describe("POST /sync", () => {
  it("validates the body and returns a runId", async () => {
    const runStore = new RunStore();
    const app = createApp({ runStore, startSync: async () => {} });
    const res = await app.request("/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "chesscom", username: "me", since: 0, until: 1, timeClasses: ["rapid"] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ runId: expect.stringMatching(/^run_/) });
  });

  it("rejects an invalid body", async () => {
    const app = createApp({ runStore: new RunStore(), startSync: async () => {} });
    const res = await app.request("/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "chesscom" }),
    });
    expect(res.status).toBe(400);
  });

  it("re-attaches to the in-flight run instead of starting a second concurrent sync", async () => {
    const runStore = new RunStore();
    let active: string | null = null;
    let starts = 0;
    const app = createApp({
      runStore,
      // mimic the server: set active synchronously, never resolve within the test
      startSync: (runId) => { starts++; active = runId; return new Promise<void>(() => {}); },
      getActiveRunId: () => active,
    });
    const body = JSON.stringify({ source: "chesscom", username: "me", since: 0, until: 1, timeClasses: ["rapid"] });
    const post = () => app.request("/sync", { method: "POST", headers: { "content-type": "application/json" }, body });

    const id1 = (await (await post()).json() as { runId: string }).runId;
    const id2 = (await (await post()).json() as { runId: string }).runId;

    expect(id2).toBe(id1);
    expect(starts).toBe(1);
  });
});

describe("games + occurrences routes", () => {
  const summary = GameSummary.parse({ id: "g1", source: "chesscom", openingName: "Sicilian Defense",
    eco: "B20", myColor: "white", result: "loss", timeClass: "rapid", endTime: 1, myRating: 1500, oppRating: 1490 });
  const review = GameReview.parse({ ...summary, moves: [] });
  const occ = LeakOccurrence.parse({ gameId: "g1", ply: 2, result: "loss", endTime: 1,
    openingName: "Sicilian Defense", myColor: "white" });

  it("GET /games returns summaries", async () => {
    const app = createApp({ runStore: new RunStore(), startSync: async () => {}, getGames: async () => [summary] });
    expect(await (await app.request("/games")).json()).toEqual([summary]);
  });

  it("GET /games/:id returns a review or 404", async () => {
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getGame: async (id) => (id === "g1" ? review : null) });
    expect(await (await app.request("/games/g1")).json()).toEqual(review);
    expect((await app.request("/games/missing")).status).toBe(404);
  });

  it("GET /leaks/occurrences passes epd+san to the query", async () => {
    let seen: [string, string] | null = null;
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getOccurrences: async (epd, san) => { seen = [epd, san]; return [occ]; } });
    const res = await app.request("/leaks/occurrences?epd=" + encodeURIComponent("E w - -") + "&san=d4");
    expect(await res.json()).toEqual([occ]);
    expect(seen).toEqual(["E w - -", "d4"]);
  });
});

describe("study + tree routes", () => {
  const opening = OpeningListItem.parse({ epd: "E", eco: "B20", name: "Sicilian" });
  const explore = ExploreResult.parse({ epd: "E", source: "masters", total: 0, bookMoves: [],
    evalWhiteCp: null, lines: [] });
  const analysis = PositionAnalysis.parse({ epd: "E", evalWhiteCp: 20, scoreCp: 20, mateIn: null,
    lines: [], depth: 18, engineVersion: "v" });
  const tree = TreeChildren.parse({ epd: "E", color: "white", children: [] });

  it("GET /openings passes the query through", async () => {
    let seen = "";
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getOpenings: async (q) => { seen = q; return [opening]; } });
    expect(await (await app.request("/openings?q=sic")).json()).toEqual([opening]);
    expect(seen).toBe("sic");
  });

  it("GET /explore passes epd + source", async () => {
    let seen: [string, string] | null = null;
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      explore: async (epd, source) => { seen = [epd, source]; return explore; } });
    expect(await (await app.request("/explore?epd=E&source=masters")).json()).toEqual(explore);
    expect(seen).toEqual(["E", "masters"]);
  });

  it("GET /position returns analysis, or 409 while a run is active", async () => {
    const ok = createApp({ runStore: new RunStore(), startSync: async () => {},
      getActiveRunId: () => null, analyzePosition: async () => analysis });
    expect(await (await ok.request("/position?fen=" + encodeURIComponent("E w - - 0 1"))).json()).toEqual(analysis);
    const busy = createApp({ runStore: new RunStore(), startSync: async () => {},
      getActiveRunId: () => "run1", analyzePosition: async () => analysis });
    expect((await busy.request("/position?fen=" + encodeURIComponent("E w - - 0 1"))).status).toBe(409);
  });

  it("GET /tree passes color + epd", async () => {
    let seen: [string, string | undefined] | null = null;
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getTree: async (color, epd) => { seen = [color, epd]; return tree; } });
    expect(await (await app.request("/tree?color=white&epd=E")).json()).toEqual(tree);
    expect(seen).toEqual(["white", "E"]);
  });
});

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { SyncRequest, DrillResultsBatch, type Leak, type GameSummary, type GameReview, type LeakOccurrence,
  type OpeningListItem, type ExploreResult, type PositionAnalysis, type TreeChildren,
  type DrillRecommendation } from "@coc/shared";
import type { RunStore } from "../runStore.js";

export interface AppDeps {
  runStore: RunStore;
  startSync: (runId: string, req: SyncRequest) => Promise<void>;
  /** Returns the id of an in-flight run, or null when idle. Used to refuse concurrent syncs. */
  getActiveRunId?: () => string | null;
  getLeaks?: () => Promise<Leak[]>;
  getGames?: () => Promise<GameSummary[]>;
  getGame?: (id: string) => Promise<GameReview | null>;
  getOccurrences?: (epd: string, san: string) => Promise<LeakOccurrence[]>;
  getOpenings?: (q: string) => Promise<OpeningListItem[]>;
  explore?: (epd: string, source: "masters" | "rating") => Promise<ExploreResult>;
  analyzePosition?: (fen: string) => Promise<PositionAnalysis>;
  getTree?: (color: "white" | "black", epd?: string) => Promise<TreeChildren>;
  saveDrillResults?: (batch: DrillResultsBatch) => Promise<{ saved: number }>;
  getDrillRecommendations?: () => Promise<DrillRecommendation[]>;
}

export function createApp(deps: AppDeps) {
  const app = new Hono()
    .post("/sync", zValidator("json", SyncRequest), (c) => {
      const req = c.req.valid("json");
      // Only one sync at a time: a second click re-attaches to the running run instead of
      // launching a parallel one that would race it on inserts and duplicate the engine work.
      const active = deps.getActiveRunId?.();
      if (active) return c.json({ runId: active });
      const runId = deps.runStore.create();
      void deps.startSync(runId, req);
      return c.json({ runId });
    })
    .get("/sync/:id/progress", (c) => {
      const runId = c.req.param("id");
      return streamSSE(c, async (stream) => {
        const cur = deps.runStore.get(runId);
        if (cur) await stream.writeSSE({ data: JSON.stringify(cur) });
        // If the run already finished before this client connected, there will be no further update
        // to resolve on — close out now instead of leaving the handler hanging until disconnect.
        if (cur && (cur.phase === "done" || cur.phase === "error")) return;
        await new Promise<void>((resolve) => {
          const unsub = deps.runStore.subscribe(runId, (p) => {
            void stream.writeSSE({ data: JSON.stringify(p) });
            if (p.phase === "done" || p.phase === "error") { unsub(); resolve(); }
          });
        });
      });
    })
    .get("/leaks", async (c) => c.json((await deps.getLeaks?.()) ?? []))
    .get("/leaks/occurrences", zValidator("query", z.object({ epd: z.string(), san: z.string() })), async (c) => {
      const { epd, san } = c.req.valid("query");
      return c.json((await deps.getOccurrences?.(epd, san)) ?? []);
    })
    .get("/games", async (c) => c.json((await deps.getGames?.()) ?? []))
    .get("/games/:id", async (c) => {
      const game = await deps.getGame?.(c.req.param("id"));
      return game ? c.json(game) : c.json({ error: "not found" }, 404);
    })
    .get("/openings", zValidator("query", z.object({ q: z.string() })), async (c) =>
      c.json((await deps.getOpenings?.(c.req.valid("query").q)) ?? []))
    .get("/explore", zValidator("query", z.object({ epd: z.string(), source: z.enum(["masters", "rating"]) })), async (c) => {
      const { epd, source } = c.req.valid("query");
      const r = await deps.explore?.(epd, source);
      return r ? c.json(r) : c.json({ error: "explore unavailable" }, 503);
    })
    .get("/position", zValidator("query", z.object({ fen: z.string() })), async (c) => {
      if (deps.getActiveRunId?.()) return c.json({ error: "engine busy: sync in progress" }, 409);
      const r = await deps.analyzePosition?.(c.req.valid("query").fen);
      return r ? c.json(r) : c.json({ error: "analysis unavailable" }, 503);
    })
    .get("/tree", zValidator("query", z.object({ color: z.enum(["white", "black"]), epd: z.string().optional() })), async (c) => {
      const { color, epd } = c.req.valid("query");
      const r = await deps.getTree?.(color, epd);
      return r ? c.json(r) : c.json({ epd: epd ?? "", color, children: [] }, 200);
    })
    .post("/drill/results", zValidator("json", DrillResultsBatch), async (c) => {
      const batch = c.req.valid("json");
      return c.json((await deps.saveDrillResults?.(batch)) ?? { saved: 0 });
    })
    .get("/drill/recommended", async (c) => c.json((await deps.getDrillRecommendations?.()) ?? []));
  return app;
}

export type AppType = ReturnType<typeof createApp>;

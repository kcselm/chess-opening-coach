import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { SyncRequest, type Leak, type GameSummary, type GameReview, type LeakOccurrence } from "@coc/shared";
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
    });
  return app;
}

export type AppType = ReturnType<typeof createApp>;

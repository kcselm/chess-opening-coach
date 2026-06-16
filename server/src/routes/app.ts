import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { SyncRequest } from "@coc/shared";
import type { RunStore } from "../runStore.js";

export interface AppDeps {
  runStore: RunStore;
  startSync: (runId: string, req: SyncRequest) => Promise<void>;
}

export function createApp(deps: AppDeps) {
  const app = new Hono()
    .post("/sync", zValidator("json", SyncRequest), (c) => {
      const req = c.req.valid("json");
      const runId = deps.runStore.create();
      void deps.startSync(runId, req);
      return c.json({ runId });
    })
    .get("/sync/:id/progress", (c) => {
      const runId = c.req.param("id");
      return streamSSE(c, async (stream) => {
        const cur = deps.runStore.get(runId);
        if (cur) await stream.writeSSE({ data: JSON.stringify(cur) });
        await new Promise<void>((resolve) => {
          const unsub = deps.runStore.subscribe(runId, (p) => {
            void stream.writeSSE({ data: JSON.stringify(p) });
            if (p.phase === "done" || p.phase === "error") {
              unsub();
              resolve();
            }
          });
        });
      });
    });
  return app;
}

export type AppType = ReturnType<typeof createApp>;

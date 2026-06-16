import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./routes/app.js";
import { RunStore } from "./runStore.js";
import { createDb } from "./db/client.js";
import { EngineManager } from "./engine/engineManager.js";
import { ChesscomSource } from "./sources/chesscom.js";
import { ingestGames } from "./ingest/ingestService.js";
import { analyzePositions } from "./analysis/orchestrator.js";
import type { SyncRequest } from "@coc/shared";

const PORT = Number(process.env.PORT ?? 8787);
const DEPTH = Number(process.env.ENGINE_DEPTH ?? 18);
const MULTIPV = Number(process.env.ENGINE_MULTIPV ?? 3);
const MAX_PLIES = 30;

const db = createDb();
const runStore = new RunStore();
const engine = new EngineManager();
let engineStarted = false;

async function startSync(runId: string, req: SyncRequest) {
  try {
    if (!engineStarted) { await engine.start(); engineStarted = true; }
    runStore.update(runId, { phase: "fetching" });
    const source = new ChesscomSource();
    await ingestGames(db, source, req, MAX_PLIES, (gamesFetched) =>
      runStore.update(runId, { gamesFetched }));

    runStore.update(runId, { phase: "analyzing" });
    const analyzer = { version: (engine as any).version ?? "stockfish",
      analyze: (fen: string, d: number, mpv: number) => engine.analyze(fen, d, mpv) };
    await analyzePositions(db, analyzer, { depth: DEPTH, multipv: MULTIPV },
      (positionsAnalyzed, positionsTotal) =>
        runStore.update(runId, { positionsAnalyzed, positionsTotal }));

    runStore.update(runId, { phase: "done" });
  } catch (e) {
    runStore.update(runId, { phase: "error", message: (e as Error).message });
  }
}

const app = createApp({ runStore, startSync });
serve({ fetch: app.fetch, port: PORT });
console.log(`server on http://localhost:${PORT}`);

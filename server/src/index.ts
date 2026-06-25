import "dotenv/config";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { createApp } from "./routes/app.js";
import { RunStore } from "./runStore.js";
import { createDb, schema } from "./db/client.js";
import { EngineManager } from "./engine/engineManager.js";
import { sourceFor } from "./sources/factory.js";
import { ingestGames } from "./ingest/ingestService.js";
import { analyzePositions } from "./analysis/orchestrator.js";
import { getBook } from "./book/explorerClient.js";
import { classifyMoves } from "./classify/classifyService.js";
import { DEFAULT_THRESHOLDS } from "./classify/classifier.js";
import { loadOpeningTable, pickOpening } from "./openings/seed.js";
import { getLeaks } from "./leaks/leaksQuery.js";
import { getGameReview } from "./games/gameReview.js";
import { getLeakOccurrences } from "./leaks/leakOccurrences.js";
import { searchOpenings } from "./openings/searchOpenings.js";
import { getExplore } from "./study/getExplore.js";
import { analyzeOnDemand } from "./study/analyzeOnDemand.js";
import { getTreeChildren } from "./tree/getTreeChildren.js";
import { saveDrillResults } from "./drill/resultsStore.js";
import { getDrillRecommendations } from "./drill/recommendedQuery.js";
import type { SyncRequest } from "@coc/shared";

const PORT = Number(process.env.PORT ?? 8787);
const DEPTH = Number(process.env.ENGINE_DEPTH ?? 18);
const MULTIPV = Number(process.env.ENGINE_MULTIPV ?? 3);
const MAX_PLIES = 30;

const db = createDb();
const runStore = new RunStore();
const engine = new EngineManager();
let engineStarted = false;
let activeRunId: string | null = null;

function engineVersion(): string {
  return (engine as any).version ?? "stockfish";
}

async function startSync(runId: string, req: SyncRequest) {
  activeRunId = runId; // set synchronously (before any await) so a concurrent POST sees it
  try {
    if (!engineStarted) { await engine.start(); engineStarted = true; }
    runStore.update(runId, { phase: "fetching" });
    const source = sourceFor(req.source, process.env.LICHESS_TOKEN);
    const ingest = await ingestGames(db, source, req, MAX_PLIES, (gamesFetched) =>
      runStore.update(runId, { gamesFetched }));

    runStore.update(runId, { phase: "analyzing" });
    const analyzer = { version: engineVersion(),
      analyze: (fen: string, d: number, mpv: number) => engine.analyze(fen, d, mpv) };
    await analyzePositions(db, analyzer, { depth: DEPTH, multipv: MULTIPV },
      (positionsAnalyzed, positionsTotal) =>
        runStore.update(runId, { positionsAnalyzed, positionsTotal }));

    // book lookups for every analyzed position-before-a-move (masters)
    const epds = [...new Set((await db.select({ e: schema.moves.epdBefore }).from(schema.moves)).map((r) => r.e))];
    for (const epd of epds) { try { await getBook(db, epd, "masters"); } catch { /* book stays unknown */ } }

    // name openings per game from the positions it passed through
    runStore.update(runId, { phase: "classifying" });
    const table = await loadOpeningTable(db);
    const gameRows = await db.select().from(schema.games);
    for (const g of gameRows) {
      const epdsInOrder = (await db.select({ e: schema.moves.epdAfter, ply: schema.moves.ply })
        .from(schema.moves).where(eq(schema.moves.gameId, g.id))).sort((a, b) => a.ply - b.ply).map((r) => r.e);
      const op = pickOpening(epdsInOrder, table);
      if (op) await db.update(schema.games).set({ eco: op.eco, openingName: op.name }).where(eq(schema.games.id, g.id));
    }

    await classifyMoves(db, { depth: DEPTH, engineVersion: engineVersion(), thresholds: DEFAULT_THRESHOLDS });

    runStore.update(runId, {
      phase: "done",
      message: ingest.skipped.length ? `Skipped ${ingest.skipped.length} unparseable game(s)` : undefined,
    });
  } catch (e) {
    runStore.update(runId, { phase: "error", message: (e as Error).message });
  } finally {
    activeRunId = null;
  }
}

const app = createApp({
  runStore, startSync,
  getActiveRunId: () => activeRunId,
  getLeaks: () => getLeaks(db, { minCpLoss: DEFAULT_THRESHOLDS.mistake, depth: DEPTH,
    engineVersion: engineVersion(), limit: 50 }),
  getGames: async () => (await db.select().from(schema.games)).map((g) => ({
    id: g.id, source: g.source as "chesscom" | "lichess", openingName: g.openingName, eco: g.eco,
    myColor: g.myColor as "white" | "black", result: g.result as "win" | "loss" | "draw",
    timeClass: g.timeClass as "bullet" | "blitz" | "rapid" | "classical" | "daily",
    endTime: g.endTime, myRating: g.myRating, oppRating: g.oppRating })),
  getGame: (id) => getGameReview(db, id, { depth: DEPTH, engineVersion: engineVersion() }),
  getOccurrences: (epd, san) => getLeakOccurrences(db, epd, san),
  getOpenings: (q) => searchOpenings(db, q),
  explore: (epd, source) => getExplore(db, epd, source, { depth: DEPTH, engineVersion: engineVersion() }),
  analyzePosition: async (fen) => {
    if (!engineStarted) { await engine.start(); engineStarted = true; }
    const analyzer = { version: engineVersion(), analyze: (f: string, d: number, mpv: number) => engine.analyze(f, d, mpv) };
    return analyzeOnDemand(db, analyzer, { depth: DEPTH, multipv: MULTIPV }, fen);
  },
  getTree: (color, epd) => getTreeChildren(db, color, epd),
  saveDrillResults: (batch) => saveDrillResults(db, batch.attempts),
  getDrillRecommendations: async () =>
    getDrillRecommendations(
      db,
      await getLeaks(db, { minCpLoss: DEFAULT_THRESHOLDS.mistake, depth: DEPTH, engineVersion: engineVersion(), limit: 50 }),
      { staleDays: 14, now: Math.floor(Date.now() / 1000), limit: 30 }
    ),
});
serve({ fetch: app.fetch, port: PORT });
console.log(`server on http://localhost:${PORT}`);

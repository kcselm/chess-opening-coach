import { and, eq } from "drizzle-orm";
import { toEpd, type PositionAnalysis, type EngineLine } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import type { Analyzer } from "../analysis/orchestrator.js";
import { whitePovCp } from "../analysis/whitePov.js";

export interface AnalyzeOnDemandOpts { depth: number; multipv: number }

/** Cached-or-fresh Stockfish analysis of one full FEN. Writes the cache identically to the sync
 *  orchestrator (same key + lines layout) so on-demand and sync evals are interchangeable. */
export async function analyzeOnDemand(db: Db, engine: Analyzer, opts: AnalyzeOnDemandOpts, fen: string): Promise<PositionAnalysis> {
  const epd = toEpd(fen);
  const key = and(eq(schema.positionEvals.epd, epd), eq(schema.positionEvals.depth, opts.depth),
    eq(schema.positionEvals.engineVersion, engine.version));

  let row = (await db.select().from(schema.positionEvals).where(key))[0];
  if (!row) {
    const res = await engine.analyze(fen, opts.depth, opts.multipv);
    const best = res.lines[0];
    await db.insert(schema.positionEvals).values({
      epd, depth: opts.depth, engineVersion: engine.version,
      scoreCp: best?.scoreCp ?? null, mateIn: best?.mateIn ?? null,
      linesJson: JSON.stringify(res.lines),
    }).onConflictDoNothing();
    row = (await db.select().from(schema.positionEvals).where(key))[0];
  }

  const lines = JSON.parse(row!.linesJson) as EngineLine[];
  return {
    epd, evalWhiteCp: whitePovCp(epd, row!),
    scoreCp: row!.scoreCp, mateIn: row!.mateIn, lines,
    depth: opts.depth, engineVersion: engine.version,
  };
}

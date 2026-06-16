import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import type { EvalResult } from "@coc/shared";
import { scoreToCp } from "@coc/shared";

export interface Analyzer {
  version: string;
  analyze(fen: string, depth: number, multipv: number): Promise<EvalResult>;
}

export interface AnalyzeOptions { depth: number; multipv: number }

export async function analyzePositions(
  db: Db, engine: Analyzer, opts: AnalyzeOptions,
  onProgress?: (analyzed: number, total: number) => void
): Promise<{ analyzed: number }> {
  const rows = await db.select({
    epdBefore: schema.moves.epdBefore, fenBefore: schema.moves.fenBefore,
    epdAfter: schema.moves.epdAfter, fenAfter: schema.moves.fenAfter,
  }).from(schema.moves);

  const fenByEpd = new Map<string, string>();
  for (const r of rows) {
    if (!fenByEpd.has(r.epdBefore)) fenByEpd.set(r.epdBefore, r.fenBefore);
    if (!fenByEpd.has(r.epdAfter)) fenByEpd.set(r.epdAfter, r.fenAfter);
  }

  const targets = [...fenByEpd.entries()];
  let analyzed = 0;
  for (const [epd, fen] of targets) {
    const exists = await db.select({ epd: schema.positionEvals.epd })
      .from(schema.positionEvals)
      .where(and(eq(schema.positionEvals.epd, epd), eq(schema.positionEvals.depth, opts.depth),
        eq(schema.positionEvals.engineVersion, engine.version)));
    if (exists.length) continue;

    const res = await engine.analyze(fen, opts.depth, opts.multipv);
    const best = res.lines[0];
    await db.insert(schema.positionEvals).values({
      epd, depth: opts.depth, engineVersion: engine.version,
      scoreCp: best?.scoreCp ?? null, mateIn: best?.mateIn ?? null,
      linesJson: JSON.stringify(res.lines),
    });
    analyzed++;
    onProgress?.(analyzed, targets.length);
  }
  return { analyzed };
}

export async function cachedBestCp(db: Db, epd: string, depth: number, version: string): Promise<number | null> {
  const rows = await db.select().from(schema.positionEvals)
    .where(and(eq(schema.positionEvals.epd, epd), eq(schema.positionEvals.depth, depth),
      eq(schema.positionEvals.engineVersion, version)));
  const r = rows[0];
  if (!r) return null;
  return scoreToCp({ scoreCp: r.scoreCp, mateIn: r.mateIn });
}

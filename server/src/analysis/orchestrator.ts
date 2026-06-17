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

  // One query for everything already evaluated at this depth+version. We use it both to skip the
  // engine and to seed the progress counter, so a resumed run reports where it left off (e.g.
  // 276/6775) instead of appearing to restart from 0.
  const cachedRows = await db.select({ epd: schema.positionEvals.epd })
    .from(schema.positionEvals)
    .where(and(eq(schema.positionEvals.depth, opts.depth),
      eq(schema.positionEvals.engineVersion, engine.version)));
  const cached = new Set(cachedRows.map((r) => r.epd));

  const total = targets.length;
  let done = targets.reduce((n, [epd]) => n + (cached.has(epd) ? 1 : 0), 0);
  onProgress?.(done, total);

  let analyzed = 0;
  for (const [epd, fen] of targets) {
    if (cached.has(epd)) continue;

    const res = await engine.analyze(fen, opts.depth, opts.multipv);
    const best = res.lines[0];
    // onConflictDoNothing keeps the insert idempotent: a re-run, or a second sync racing on the
    // same position between our cache snapshot and this write, is a no-op rather than a crash.
    await db.insert(schema.positionEvals).values({
      epd, depth: opts.depth, engineVersion: engine.version,
      scoreCp: best?.scoreCp ?? null, mateIn: best?.mateIn ?? null,
      linesJson: JSON.stringify(res.lines),
    }).onConflictDoNothing();
    cached.add(epd);
    analyzed++;
    done++;
    onProgress?.(done, total);
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

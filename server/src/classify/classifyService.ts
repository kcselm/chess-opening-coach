import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import { scoreToCp } from "@coc/shared";
import { classifyMove, type Thresholds } from "./classifier.js";

export interface ClassifyServiceOpts {
  depth: number;
  engineVersion: string;
  thresholds: Thresholds;
  bookSource?: "masters" | "rating";
}

export async function classifyMoves(db: Db, opts: ClassifyServiceOpts): Promise<{ classified: number }> {
  const bookSource = opts.bookSource ?? "masters";
  const evalRows = await db.select().from(schema.positionEvals)
    .where(and(eq(schema.positionEvals.depth, opts.depth), eq(schema.positionEvals.engineVersion, opts.engineVersion)));
  const bestByEpd = new Map(evalRows.map((r) => [r.epd, scoreToCp({ scoreCp: r.scoreCp, mateIn: r.mateIn })]));

  const bookRows = await db.select().from(schema.bookStats).where(eq(schema.bookStats.source, bookSource));
  const bookByEpd = new Map(bookRows.map((r) => [r.epd, { moves: JSON.parse(r.movesJson) as { san: string; uci: string }[] }]));

  const moves = await db.select().from(schema.moves).where(eq(schema.moves.isMine, true));
  let classified = 0;
  for (const m of moves) {
    const bestBefore = bestByEpd.get(m.epdBefore);
    const bestAfter = bestByEpd.get(m.epdAfter);
    if (bestBefore === undefined || bestAfter === undefined) continue;
    const r = classifyMove({
      playedSan: m.san, bestCpBefore: bestBefore, bestCpAfter: bestAfter,
      book: bookByEpd.get(m.epdBefore) ?? null, thresholds: opts.thresholds,
    });
    await db.update(schema.moves).set({
      evalBestCp: bestBefore, evalPlayedCp: r.evalPlayedCp, cpLoss: r.cpLoss,
      classification: r.classification, bookStatus: r.bookStatus,
    }).where(eq(schema.moves.id, m.id));
    classified++;
  }
  return { classified };
}

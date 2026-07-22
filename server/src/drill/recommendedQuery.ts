import { lte } from "drizzle-orm";
import { toEpd, type Leak, type DrillRecommendation, type DrillReason } from "@coc/shared";
import { schema, type Db } from "../db/client.js";

export interface RecommendOpts { now: number; limit: number }

const REASON_RANK: Record<DrillReason, number> = { leak: 0, due: 1 };

/** Ranked "what to drill": leaks (drill from the leak position, top precedence) then openings that
 *  hold ≥1 card past its dueAt. Deduped by opening EPD; due score = number of due cards. */
export async function getDrillRecommendations(
  db: Db, leaks: Leak[], opts: RecommendOpts
): Promise<DrillRecommendation[]> {
  const byEpd = new Map<string, DrillRecommendation>();

  // 1. Leaks — highest precedence; drill starts at the leak position itself.
  for (const lk of leaks) {
    const epd = toEpd(lk.fenBefore);
    if (!byEpd.has(epd)) byEpd.set(epd, {
      openingEpd: epd, openingName: lk.openingName, eco: lk.eco,
      reason: "leak", score: lk.occurrences * lk.avgCpLoss, lastDrilled: null,
    });
  }

  // 2. Due cards → group by opening.
  const due = await db.select().from(schema.drillSchedule).where(lte(schema.drillSchedule.dueAt, opts.now));
  const catalog = new Map((await db.select().from(schema.openings)).map((o) => [o.epd, o]));
  interface DueAgg { name: string | null; count: number; last: number }
  const aggs = new Map<string, DueAgg>();
  for (const r of due) {
    if (!r.openingEpd) continue;
    const a = aggs.get(r.openingEpd) ?? { name: r.openingName, count: 0, last: -Infinity };
    a.count += 1;
    a.last = Math.max(a.last, r.lastReviewedAt);
    a.name = r.openingName ?? a.name;
    aggs.set(r.openingEpd, a);
  }
  for (const [openingEpd, a] of aggs) {
    if (byEpd.has(openingEpd)) continue; // a leak already covers this opening
    const cat = catalog.get(openingEpd);
    byEpd.set(openingEpd, {
      openingEpd, openingName: cat?.name ?? a.name ?? "Unknown opening", eco: cat?.eco ?? null,
      reason: "due", score: a.count, lastDrilled: a.last,
    });
  }

  return [...byEpd.values()]
    .sort((x, y) => REASON_RANK[x.reason] - REASON_RANK[y.reason] || y.score - x.score)
    .slice(0, opts.limit);
}

import { asc } from "drizzle-orm";
import { toEpd, type Leak, type DrillRecommendation, type DrillReason } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";

export interface RecommendOpts { staleDays: number; now: number; limit: number }

const REASON_RANK: Record<DrillReason, number> = { leak: 0, failed: 1, stale: 2 };

/** Ranked "what to drill" list: leaks (drill from the leak position), openings with an unresolved
 *  first-try failure, and openings gone stale. Deduped by opening EPD, precedence leak > failed > stale. */
export async function getDrillRecommendations(
  db: Db, leaks: Leak[], opts: RecommendOpts
): Promise<DrillRecommendation[]> {
  const byEpd = new Map<string, DrillRecommendation>();

  // 1. Leaks — highest precedence; drill starts at the leak position itself.
  for (const lk of leaks) {
    const epd = toEpd(lk.fenBefore);
    if (!byEpd.has(epd)) {
      byEpd.set(epd, {
        openingEpd: epd, openingName: lk.openingName, eco: lk.eco,
        reason: "leak", score: lk.occurrences * lk.avgCpLoss, lastDrilled: null,
      });
    }
  }

  // 2. Aggregate past attempts by the opening the user drilled (rows in chronological id order, so
  //    the last write per (openingEpd, epd) is the most recent first-try outcome).
  const rows = await db.select().from(schema.drillAttempts).orderBy(asc(schema.drillAttempts.id));
  interface Agg { name: string | null; last: number; latestPassByEpd: Map<string, boolean> }
  const aggs = new Map<string, Agg>();
  for (const r of rows) {
    if (!r.openingEpd) continue;
    let a = aggs.get(r.openingEpd);
    if (!a) { a = { name: r.openingName, last: -Infinity, latestPassByEpd: new Map() }; aggs.set(r.openingEpd, a); }
    if (r.createdAt >= a.last) { a.last = r.createdAt; a.name = r.openingName; }
    a.latestPassByEpd.set(r.epd, r.pass);
  }

  const catalog = new Map((await db.select().from(schema.openings)).map((o) => [o.epd, o]));
  const staleCutoff = opts.now - opts.staleDays * 86400;

  for (const [openingEpd, a] of aggs) {
    if (byEpd.has(openingEpd)) continue; // a leak already covers this position
    const failures = [...a.latestPassByEpd.values()].filter((p) => !p).length;
    const cat = catalog.get(openingEpd);
    const base = {
      openingEpd,
      openingName: cat?.name ?? a.name ?? "Unknown opening",
      eco: cat?.eco ?? null,
      lastDrilled: a.last,
    };
    if (failures > 0) {
      byEpd.set(openingEpd, { ...base, reason: "failed", score: failures });
    } else if (a.last < staleCutoff) {
      byEpd.set(openingEpd, { ...base, reason: "stale", score: (opts.now - a.last) / 86400 });
    }
  }

  return [...byEpd.values()]
    .sort((x, y) => REASON_RANK[x.reason] - REASON_RANK[y.reason] || y.score - x.score)
    .slice(0, opts.limit);
}

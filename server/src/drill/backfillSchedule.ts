import { asc } from "drizzle-orm";
import type { Color, BookSource, DrillAttempt } from "@coc/shared";
import { schema, type Db } from "../db/client.js";
import { upsertCardReview } from "./scheduleStore.js";

/** Rebuild drill_schedule from scratch by replaying every drill_attempts row through SM-2 in
 *  chronological (id) order. Idempotent: clears the table first, so it is safe to re-run to resync.
 *  Same function + order as the live per-attempt path, so incremental and batch folds agree. */
export async function backfillSchedule(db: Db): Promise<{ cards: number }> {
  await db.delete(schema.drillSchedule);
  const rows = await db.select().from(schema.drillAttempts).orderBy(asc(schema.drillAttempts.id));
  for (const r of rows) {
    if (r.cpLoss === null) continue; // ungradable — never a review
    const a: DrillAttempt = {
      epd: r.epd, openingEpd: r.openingEpd, openingName: r.openingName,
      color: r.color as Color, source: r.source as BookSource,
      playedUci: r.playedUci, pass: r.pass, cpLoss: r.cpLoss,
    };
    await upsertCardReview(db, a, r.createdAt);
  }
  return { cards: (await db.select().from(schema.drillSchedule)).length };
}

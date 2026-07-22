import { and, eq } from "drizzle-orm";
import { scheduleReview, gradeFromDrill, type DrillAttempt, type CardState } from "@coc/shared";
import { schema, type Db } from "../db/client.js";

/** Fold one first-try attempt into its (epd, color) card via SM-2: read the prior state, advance it,
 *  upsert. Used both per-attempt on save and per-row during backfill. */
export async function upsertCardReview(db: Db, a: DrillAttempt, reviewedAt: number): Promise<void> {
  const prev =
    (await db
      .select()
      .from(schema.drillSchedule)
      .where(and(eq(schema.drillSchedule.epd, a.epd), eq(schema.drillSchedule.color, a.color))))[0] ?? null;
  const next: CardState = scheduleReview(prev, gradeFromDrill(a), reviewedAt);
  await db
    .insert(schema.drillSchedule)
    .values({ epd: a.epd, color: a.color, openingEpd: a.openingEpd, openingName: a.openingName, ...next })
    .onConflictDoUpdate({
      target: [schema.drillSchedule.epd, schema.drillSchedule.color],
      set: { openingEpd: a.openingEpd, openingName: a.openingName, ...next },
    });
}

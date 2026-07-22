import { DEFAULT_DRILL_TUNING, type DrillAttempt, type DrillTuning } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import { upsertCardReview } from "./scheduleStore.js";

/** Append first-try drill outcomes, all stamped with one timestamp. Append-only: replaying a line
 *  later just adds rows. Also folds each gradable attempt into its SM-2 card. Returns how many were
 *  written. `tuning` sets grade buckets + ease; defaults to the SM-2 standard. */
export async function saveDrillResults(
  db: Db, attempts: DrillAttempt[], now: () => number = () => Math.floor(Date.now() / 1000),
  tuning: DrillTuning = DEFAULT_DRILL_TUNING
): Promise<{ saved: number }> {
  if (attempts.length === 0) return { saved: 0 };
  const createdAt = now();
  await db.insert(schema.drillAttempts).values(
    attempts.map((a) => ({
      epd: a.epd, openingEpd: a.openingEpd, openingName: a.openingName, color: a.color,
      source: a.source, playedUci: a.playedUci, pass: a.pass, cpLoss: a.cpLoss, createdAt,
    }))
  );
  for (const a of attempts) {
    if (a.cpLoss === null) continue; // ungradable — never a review (matches backfill; keeps store⇄backfill parity)
    await upsertCardReview(db, a, createdAt, tuning);
  }
  return { saved: attempts.length };
}

import type { DrillAttempt } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import { upsertCardReview } from "./scheduleStore.js";

/** Append first-try drill outcomes, all stamped with one timestamp. Append-only: replaying a line
 *  later just adds rows. Returns how many were written. */
export async function saveDrillResults(
  db: Db, attempts: DrillAttempt[], now: () => number = () => Math.floor(Date.now() / 1000)
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
    await upsertCardReview(db, a, createdAt);
  }
  return { saved: attempts.length };
}

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { backfillSchedule } from "./backfillSchedule.js";
import { upsertCardReview } from "./scheduleStore.js";
import type { DrillAttempt } from "@coc/shared";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE drill_attempts (id integer primary key autoincrement, epd text,
    opening_epd text, opening_name text, color text, source text, played_uci text,
    pass integer, cp_loss integer, created_at integer);`);
  await c.execute(`CREATE TABLE drill_schedule (epd text, color text, opening_epd text, opening_name text,
    ease_factor real, interval_days integer, reps integer, due_at integer,
    last_reviewed_at integer, last_grade integer, PRIMARY KEY (epd, color));`);
  return drizzle(c, { schema });
}

// two successful reviews of the same card on different days + an ungradable row that must be skipped
const rows = [
  { epd: "P w - -", openingEpd: "R w - -", openingName: "Caro", color: "black", source: "rating",
    playedUci: "e7e6", pass: true, cpLoss: 0, createdAt: 1000 },
  { epd: "P w - -", openingEpd: "R w - -", openingName: "Caro", color: "black", source: "rating",
    playedUci: "e7e6", pass: true, cpLoss: 0, createdAt: 1000 + 86400 },
  { epd: "Q w - -", openingEpd: "R w - -", openingName: "Caro", color: "black", source: "rating",
    playedUci: "c8g4", pass: true, cpLoss: null, createdAt: 2000 }, // ungradable → skipped
];

describe("backfillSchedule", () => {
  it("folds the attempts log into per-card SM-2 state and skips ungradable rows", async () => {
    const db = await memDb();
    await db.insert(schema.drillAttempts).values(rows);
    const res = await backfillSchedule(db);
    expect(res.cards).toBe(1);                         // only the gradable card
    const [card] = await db.select().from(schema.drillSchedule);
    expect(card).toMatchObject({ epd: "P w - -", color: "black", reps: 2, intervalDays: 6 });
    expect(card!.dueAt).toBe(1000 + 86400 + 6 * 86400);
  });

  it("is idempotent — re-running reproduces the same state", async () => {
    const db = await memDb();
    await db.insert(schema.drillAttempts).values(rows);
    await backfillSchedule(db);
    const first = await db.select().from(schema.drillSchedule);
    await backfillSchedule(db);
    expect(await db.select().from(schema.drillSchedule)).toEqual(first);
  });

  it("matches the incremental live path (store ⇄ backfill parity)", async () => {
    const batch = await memDb();
    await batch.insert(schema.drillAttempts).values(rows);
    await backfillSchedule(batch);
    const batchState = await batch.select().from(schema.drillSchedule);

    const incr = await memDb();
    for (const r of rows) {
      if (r.cpLoss === null) continue;
      await upsertCardReview(incr, r as unknown as DrillAttempt, r.createdAt);
    }
    expect(await incr.select().from(schema.drillSchedule)).toEqual(batchState);
  });
});

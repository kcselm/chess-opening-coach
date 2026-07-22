import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { upsertCardReview } from "./scheduleStore.js";
import type { DrillAttempt } from "@coc/shared";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE drill_schedule (epd text, color text, opening_epd text, opening_name text,
    ease_factor real, interval_days integer, reps integer, due_at integer,
    last_reviewed_at integer, last_grade integer, PRIMARY KEY (epd, color));`);
  return drizzle(c, { schema });
}

const attempt = (over: Partial<DrillAttempt>): DrillAttempt => ({
  epd: "E w - -", openingEpd: "R w - -", openingName: "Caro-Kann", color: "black",
  source: "rating", playedUci: "e7e6", pass: true, cpLoss: 0, ...over,
});

describe("upsertCardReview", () => {
  it("inserts a new card on the first review", async () => {
    const db = await memDb();
    await upsertCardReview(db, attempt({}), 1000);
    const [card] = await db.select().from(schema.drillSchedule);
    expect(card).toMatchObject({ epd: "E w - -", color: "black", reps: 1, intervalDays: 1, lastGrade: 5 });
    expect(card!.dueAt).toBe(1000 + 86400);
  });

  it("advances the same card on a later review (interval 1 → 6)", async () => {
    const db = await memDb();
    await upsertCardReview(db, attempt({}), 1000);
    await upsertCardReview(db, attempt({}), 200000);
    const rows = await db.select().from(schema.drillSchedule);
    expect(rows).toHaveLength(1);                       // upsert, not a second row
    expect(rows[0]).toMatchObject({ reps: 2, intervalDays: 6 });
    expect(rows[0]!.dueAt).toBe(200000 + 6 * 86400);
  });

  it("resets a card to interval 1 when the review fails", async () => {
    const db = await memDb();
    await upsertCardReview(db, attempt({}), 1000);
    await upsertCardReview(db, attempt({ pass: false, cpLoss: 90 }), 200000);
    const [card] = await db.select().from(schema.drillSchedule);
    expect(card).toMatchObject({ reps: 0, intervalDays: 1, lastGrade: 2 });
  });
});

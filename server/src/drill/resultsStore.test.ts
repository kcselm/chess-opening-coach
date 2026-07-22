import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { saveDrillResults } from "./resultsStore.js";
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

const attempt = (over: Partial<DrillAttempt>): DrillAttempt => ({
  epd: "E w - -", openingEpd: "R w - -", openingName: "Caro-Kann", color: "black",
  source: "rating", playedUci: "e7e6", pass: true, cpLoss: 0, ...over,
});

describe("saveDrillResults", () => {
  it("inserts each attempt with the stamped timestamp", async () => {
    const db = await memDb();
    const res = await saveDrillResults(db, [attempt({}), attempt({ playedUci: "c8g4", pass: false, cpLoss: 80 })], () => 1700);
    expect(res.saved).toBe(2);
    const rows = await db.select().from(schema.drillAttempts);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.createdAt).toBe(1700);
    const fail = (await db.select().from(schema.drillAttempts).where(eq(schema.drillAttempts.pass, false)))[0];
    expect(fail!.cpLoss).toBe(80);
  });

  it("is a no-op for an empty batch", async () => {
    const db = await memDb();
    expect(await saveDrillResults(db, [])).toEqual({ saved: 0 });
    expect(await db.select().from(schema.drillAttempts)).toHaveLength(0);
  });

  it("advances the (epd,color) card schedule alongside the attempt", async () => {
    const db = await memDb();
    await saveDrillResults(db, [attempt({ pass: true, cpLoss: 0 })], () => 1000);
    const [c1] = await db.select().from(schema.drillSchedule);
    expect(c1).toMatchObject({ epd: "E w - -", color: "black", reps: 1, intervalDays: 1 });
    expect(c1!.dueAt).toBe(1000 + 86400);

    await saveDrillResults(db, [attempt({ pass: true, cpLoss: 0 })], () => 200000);
    const [c2] = await db.select().from(schema.drillSchedule);
    expect(c2).toMatchObject({ reps: 2, intervalDays: 6 });
    expect(c2!.dueAt).toBe(200000 + 6 * 86400);
  });

  it("skips ungradable attempts (cpLoss === null) when advancing the schedule", async () => {
    const db = await memDb();
    const res = await saveDrillResults(
      db,
      [
        attempt({ epd: "gradable w - -", cpLoss: 0 }),
        attempt({ epd: "ungradable w - -", cpLoss: null }),
      ],
      () => 1000
    );
    expect(res.saved).toBe(2);
    const rows = await db.select().from(schema.drillAttempts);
    expect(rows).toHaveLength(2);

    const cards = await db.select().from(schema.drillSchedule);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.epd).toBe("gradable w - -");
  });

  it("forwards drill tuning to the schedule fold", async () => {
    const db = await memDb();
    await saveDrillResults(db, [attempt({ pass: false, cpLoss: 90 })], () => 1000,
      { buckets: { fail: 4, pass: 4, best: 5 }, ease: { start: 2.5, floor: 1.3 } });
    const [card] = await db.select().from(schema.drillSchedule);
    expect(card).toMatchObject({ reps: 1, intervalDays: 1, lastGrade: 4 });
  });
});

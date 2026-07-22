import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getDrillRecommendations } from "./recommendedQuery.js";
import type { Leak } from "@coc/shared";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE drill_schedule (epd text, color text, opening_epd text, opening_name text,
    ease_factor real, interval_days integer, reps integer, due_at integer,
    last_reviewed_at integer, last_grade integer, PRIMARY KEY (epd, color));`);
  await c.execute(`CREATE TABLE openings (epd text primary key, eco text, name text);`);
  return drizzle(c, { schema });
}

const leak = (over: Partial<Leak>): Leak => ({
  openingName: "Sicilian", eco: "B20", fenBefore: "LEAK w - - 0 1", lineSan: "", yourMoveSan: "d4",
  betterMoveSan: "Nf3", occurrences: 3, avgCpLoss: 120, scorePct: 33, bookStatus: "novelty", ...over,
});

const base = {
  epd: "p1 w - -", color: "white", openingEpd: "DUEROOT w - -", openingName: "French",
  easeFactor: 2.5, intervalDays: 1, reps: 1, dueAt: 0, lastReviewedAt: 0, lastGrade: 4,
};
const card = (over: Partial<typeof base> = {}) => ({ ...base, ...over });

describe("getDrillRecommendations", () => {
  it("ranks leak above due and dedups by opening", async () => {
    const db = await memDb();
    const NOW = 1_000_000, day = 86400;
    await db.insert(schema.openings).values({ epd: "DUEROOT w - -", eco: "C10", name: "French" });
    await db.insert(schema.drillSchedule).values([
      card({ dueAt: NOW - day, lastReviewedAt: NOW - 2 * day }),                         // due → French
      card({ epd: "p2 w - -", openingEpd: "FRESH w - -", openingName: "Italian",
        intervalDays: 6, reps: 2, dueAt: NOW + 3 * day, lastReviewedAt: NOW - day }),    // not due → omitted
    ]);

    const recs = await getDrillRecommendations(db, [leak({})], { now: NOW, limit: 10 });

    expect(recs.map((r) => r.reason)).toEqual(["leak", "due"]);
    expect(recs[0]).toMatchObject({ openingEpd: "LEAK w - -", reason: "leak", score: 360 }); // 3 × 120
    expect(recs[1]).toMatchObject({ openingEpd: "DUEROOT w - -", eco: "C10", openingName: "French", reason: "due", score: 1 });
  });

  it("omits openings with no cards due yet", async () => {
    const db = await memDb();
    const NOW = 1_000_000;
    await db.insert(schema.drillSchedule).values(
      card({ epd: "p w - -", openingEpd: "FRESH w - -", openingName: "Italian", dueAt: NOW + 5 * 86400 })
    );
    expect(await getDrillRecommendations(db, [], { now: NOW, limit: 10 })).toHaveLength(0);
  });

  it("shows an opening once as a leak even when it also has due cards", async () => {
    const db = await memDb();
    const NOW = 1_000_000;
    await db.insert(schema.drillSchedule).values(
      card({ epd: "x w - -", openingEpd: "LEAK w - -", openingName: "Sicilian", dueAt: NOW - 86400 })
    );
    const recs = await getDrillRecommendations(db, [leak({})], { now: NOW, limit: 10 });
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ openingEpd: "LEAK w - -", reason: "leak" });
  });
});

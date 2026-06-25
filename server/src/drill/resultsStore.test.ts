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
});

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getDrillRecommendations } from "./recommendedQuery.js";
import type { Leak } from "@coc/shared";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE drill_attempts (id integer primary key autoincrement, epd text,
    opening_epd text, opening_name text, color text, source text, played_uci text,
    pass integer, cp_loss integer, created_at integer);`);
  await c.execute(`CREATE TABLE openings (epd text primary key, eco text, name text);`);
  return drizzle(c, { schema });
}

const leak = (over: Partial<Leak>): Leak => ({
  openingName: "Sicilian", eco: "B20", fenBefore: "LEAK w - - 0 1", lineSan: "", yourMoveSan: "d4",
  betterMoveSan: "Nf3", occurrences: 3, avgCpLoss: 120, scorePct: 33, bookStatus: "novelty", ...over,
});

describe("getDrillRecommendations", () => {
  it("ranks leak > failed > stale and dedups by opening", async () => {
    const db = await memDb();
    await db.insert(schema.openings).values({ epd: "FAILROOT w - -", eco: "C10", name: "French" });
    const NOW = 1_000_000;
    const day = 86400;
    // an opening with an unresolved failure (latest attempt at its epd is a fail)
    await db.insert(schema.drillAttempts).values([
      { epd: "p1 w - -", openingEpd: "FAILROOT w - -", openingName: "French", color: "white",
        source: "rating", playedUci: "x", pass: false, cpLoss: 90, createdAt: NOW - day },
    ]);
    // a stale opening (drilled long ago, no failures)
    await db.insert(schema.drillAttempts).values([
      { epd: "p2 w - -", openingEpd: "STALEROOT w - -", openingName: "London", color: "white",
        source: "rating", playedUci: "y", pass: true, cpLoss: 0, createdAt: NOW - 40 * day },
    ]);

    const recs = await getDrillRecommendations(db, [leak({})], { staleDays: 14, now: NOW, limit: 10 });

    expect(recs.map((r) => r.reason)).toEqual(["leak", "failed", "stale"]);
    expect(recs[0]!.openingEpd).toBe("LEAK w - -");         // toEpd(fenBefore)
    expect(recs[0]!.score).toBe(360);                       // 3 × 120
    expect(recs[1]!).toMatchObject({ openingEpd: "FAILROOT w - -", eco: "C10", openingName: "French" });
    expect(recs[2]!.openingEpd).toBe("STALEROOT w - -");
  });

  it("omits recently-drilled openings with no open failures", async () => {
    const db = await memDb();
    const NOW = 1_000_000;
    await db.insert(schema.drillAttempts).values([
      { epd: "p w - -", openingEpd: "FRESH w - -", openingName: "Italian", color: "white",
        source: "rating", playedUci: "z", pass: true, cpLoss: 0, createdAt: NOW - 3 * 86400 },
    ]);
    const recs = await getDrillRecommendations(db, [], { staleDays: 14, now: NOW, limit: 10 });
    expect(recs).toHaveLength(0);
  });
});

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { searchOpenings } from "./searchOpenings.js";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE openings (epd text primary key, eco text, name text);`);
  const db = drizzle(c, { schema });
  await db.insert(schema.openings).values([
    { epd: "E1", eco: "B20", name: "Sicilian Defense" },
    { epd: "E2", eco: "B21", name: "Sicilian Defense: Smith-Morra Gambit" },
    { epd: "E3", eco: "C50", name: "Italian Game" },
  ]);
  return db;
}

describe("searchOpenings", () => {
  it("matches by name (case-insensitive) ordered by name", async () => {
    const db = await memDb();
    const r = await searchOpenings(db, "sicil");
    expect(r.map((o) => o.name)).toEqual(["Sicilian Defense", "Sicilian Defense: Smith-Morra Gambit"]);
  });
  it("matches by eco and respects the limit", async () => {
    const db = await memDb();
    expect((await searchOpenings(db, "C50")).map((o) => o.epd)).toEqual(["E3"]);
    expect(await searchOpenings(db, "sicil", 1)).toHaveLength(1);
  });
});

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import * as schema from "./schema.js";

async function memDb() {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  const c = (db as any).session.client as ReturnType<typeof createClient>;
  await c.execute(`CREATE TABLE games (id text primary key, source text, url text, username text,
    my_color text, result text, time_class text, end_time integer, eco text, opening_name text,
    my_rating integer, opp_rating integer, pgn text);`);
  return db;
}

describe("games table", () => {
  it("inserts and reads a row", async () => {
    const db = await memDb();
    await db.insert(schema.games).values({
      id: "chesscom:1", source: "chesscom", url: null, username: "me",
      myColor: "white", result: "win", timeClass: "rapid", endTime: 1700000000,
      eco: null, openingName: null, myRating: 1500, oppRating: 1490, pgn: "1. e4 e5",
    });
    const rows = await db.select().from(schema.games).where(eq(schema.games.id, "chesscom:1"));
    expect(rows[0]?.pgn).toBe("1. e4 e5");
  });
});

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getExplore } from "./getExplore.js";

const EPD_W = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const EPD_B = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE position_evals (epd text, depth integer, engine_version text,
    score_cp integer, mate_in integer, lines_json text, primary key (epd, depth, engine_version));`);
  await c.execute(`CREATE TABLE book_stats (epd text, source text, total integer, moves_json text,
    fetched_at integer, primary key (epd, source));`);
  const db = drizzle(c, { schema });
  // Seed a book row for EVERY epd the tests query, so getBook always hits the cache and never
  // makes a real network call. (An unseeded epd would make getBook fetch the live Lichess explorer.)
  await db.insert(schema.bookStats).values([
    { epd: EPD_W, source: "masters", total: 200,
      movesJson: JSON.stringify([{ san: "e4", uci: "e2e4", count: 120, white: 60, draws: 40, black: 20 }]), fetchedAt: 0 },
    { epd: EPD_B, source: "masters", total: 0, movesJson: "[]", fetchedAt: 0 },
    { epd: "8/8/8/8/8/8/8/8 w - -", source: "masters", total: 0, movesJson: "[]", fetchedAt: 0 },
  ]);
  await db.insert(schema.positionEvals).values([
    { epd: EPD_W, depth: 18, engineVersion: "v", scoreCp: 30, mateIn: null,
      linesJson: JSON.stringify([{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["d2d4"] }]) },
    { epd: EPD_B, depth: 18, engineVersion: "v", scoreCp: 28, mateIn: null,
      linesJson: JSON.stringify([{ rank: 1, scoreCp: 28, mateIn: null, pvUci: ["c7c5"] }]) },
  ]);
  return db;
}

describe("getExplore", () => {
  it("returns book moves + white-POV cached eval (white to move)", async () => {
    const db = await memDb();
    const r = await getExplore(db, EPD_W, "masters", { depth: 18, engineVersion: "v" });
    expect(r.total).toBe(200);
    expect(r.bookMoves).toEqual([{ san: "e4", uci: "e2e4", count: 120, white: 60, draws: 40, black: 20 }]);
    expect(r.evalWhiteCp).toBe(30);
    expect(r.lines[0]!.pvUci).toEqual(["d2d4"]);
  });
  it("negates the eval when black is to move", async () => {
    const db = await memDb();
    const r = await getExplore(db, EPD_B, "masters", { depth: 18, engineVersion: "v" });
    expect(r.evalWhiteCp).toBe(-28); // book row absent for EPD_B -> empty book, but eval is present
    expect(r.bookMoves).toEqual([]);
    expect(r.total).toBe(0);
  });
  it("returns null eval + empty lines when uncached", async () => {
    const db = await memDb();
    const r = await getExplore(db, "8/8/8/8/8/8/8/8 w - -", "masters", { depth: 18, engineVersion: "v" });
    expect(r.evalWhiteCp).toBeNull();
    expect(r.lines).toEqual([]);
  });
});

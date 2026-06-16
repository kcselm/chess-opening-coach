import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { classifyMoves } from "./classifyService.js";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  await c.execute(`CREATE TABLE position_evals (epd text, depth integer, engine_version text,
    score_cp integer, mate_in integer, lines_json text, primary key (epd, depth, engine_version));`);
  await c.execute(`CREATE TABLE book_stats (epd text, source text, total integer, moves_json text,
    fetched_at integer, primary key (epd, source));`);
  return drizzle(c, { schema });
}

describe("classifyMoves", () => {
  it("writes cpLoss, classification and bookStatus for the user's moves", async () => {
    const db = await memDb();
    await db.insert(schema.moves).values({
      gameId: "g1", ply: 0, fenBefore: "A w - - 0 1", fenAfter: "B b - - 0 1",
      epdBefore: "A w - -", epdAfter: "B b - -", san: "Nh3", uci: "g1h3", isMine: true,
    });
    await db.insert(schema.positionEvals).values([
      { epd: "A w - -", depth: 18, engineVersion: "v", scoreCp: 30, mateIn: null, linesJson: "[]" },
      { epd: "B b - -", depth: 18, engineVersion: "v", scoreCp: 90, mateIn: null, linesJson: "[]" },
    ]);
    await db.insert(schema.bookStats).values({ epd: "A w - -", source: "masters", total: 10,
      movesJson: JSON.stringify([{ san: "e4", uci: "e2e4" }]), fetchedAt: 0 });

    const res = await classifyMoves(db, { depth: 18, engineVersion: "v",
      thresholds: { inaccuracy: 50, mistake: 100, blunder: 200 } });
    expect(res.classified).toBe(1);
    const m = (await db.select().from(schema.moves).where(eq(schema.moves.gameId, "g1")))[0]!;
    expect(m.cpLoss).toBe(120);
    expect(m.classification).toBe("mistake");
    expect(m.bookStatus).toBe("novelty");
  });
});

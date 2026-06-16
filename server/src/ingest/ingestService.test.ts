import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { ingestGames } from "./ingestService.js";
import type { GameSource, FetchParams } from "../sources/types.js";
import type { NormalizedGame } from "@coc/shared";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE games (id text primary key, source text, url text, username text,
    my_color text, result text, time_class text, end_time integer, eco text, opening_name text,
    my_rating integer, opp_rating integer, pgn text);`);
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  return drizzle(c, { schema });
}

const sample: NormalizedGame = {
  source: "chesscom", sourceGameId: "1", url: null, username: "me", myColor: "white",
  result: "win", timeClass: "rapid", endTime: 1700000000, myRating: 1500, oppRating: 1490,
  pgn: "[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0",
};

class FakeSource implements GameSource {
  id = "chesscom" as const;
  constructor(private games: NormalizedGame[]) {}
  async *fetchGames(_p: FetchParams) { for (const g of this.games) yield g; }
}

const params: FetchParams = { username: "me", since: 0, until: 2_000_000_000, timeClasses: ["rapid"] };

describe("ingestGames", () => {
  it("inserts games and their opening moves", async () => {
    const db = await memDb();
    const res = await ingestGames(db, new FakeSource([sample]), params, 30);
    expect(res.gamesInserted).toBe(1);
    const moves = await db.select().from(schema.moves);
    expect(moves).toHaveLength(4);
    expect(moves[0]!.san).toBe("e4");
  });

  it("is idempotent — re-ingesting the same game inserts nothing new", async () => {
    const db = await memDb();
    await ingestGames(db, new FakeSource([sample]), params, 30);
    const res = await ingestGames(db, new FakeSource([sample]), params, 30);
    expect(res.gamesInserted).toBe(0);
    expect(await db.select().from(schema.moves)).toHaveLength(4);
  });
});

import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import type { GameSource, FetchParams } from "../sources/types.js";
import { extractOpeningMoves } from "./pgn.js";

export interface IngestResult { gamesInserted: number; gameIds: string[] }

export async function ingestGames(
  db: Db, source: GameSource, params: FetchParams, maxPlies: number,
  onProgress?: (gamesFetched: number) => void
): Promise<IngestResult> {
  let fetched = 0;
  let inserted = 0;
  const gameIds: string[] = [];
  for await (const g of source.fetchGames(params)) {
    fetched++;
    onProgress?.(fetched);
    const id = `${g.source}:${g.sourceGameId}`;
    const existing = await db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.id, id));
    if (existing.length) continue;
    await db.insert(schema.games).values({
      id, source: g.source, url: g.url, username: g.username, myColor: g.myColor,
      result: g.result, timeClass: g.timeClass, endTime: g.endTime, eco: null, openingName: null,
      myRating: g.myRating, oppRating: g.oppRating, pgn: g.pgn,
    });
    const moves = extractOpeningMoves(g.pgn, g.myColor, maxPlies);
    if (moves.length) {
      await db.insert(schema.moves).values(
        moves.map((m) => ({
          gameId: id, ply: m.ply, fenBefore: m.fenBefore, fenAfter: m.fenAfter,
          epdBefore: m.epdBefore, epdAfter: m.epdAfter, san: m.san, uci: m.uci, isMine: m.isMine,
        }))
      );
    }
    inserted++;
    gameIds.push(id);
  }
  return { gamesInserted: inserted, gameIds };
}

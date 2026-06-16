import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import type { GameSource, FetchParams } from "../sources/types.js";
import { extractOpeningMoves } from "./pgn.js";

export interface IngestResult {
  gamesInserted: number;
  gameIds: string[];
  skipped: { id: string; message: string }[];
}

export async function ingestGames(
  db: Db, source: GameSource, params: FetchParams, maxPlies: number,
  onProgress?: (gamesFetched: number) => void
): Promise<IngestResult> {
  let fetched = 0;
  let inserted = 0;
  const gameIds: string[] = [];
  const skipped: { id: string; message: string }[] = [];
  for await (const g of source.fetchGames(params)) {
    fetched++;
    onProgress?.(fetched);
    const id = `${g.source}:${g.sourceGameId}`;
    // Isolate per-game failures: one unparseable/abandoned PGN must not abort the whole run.
    try {
      const existing = await db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.id, id));
      if (existing.length) continue;
      // Parse BEFORE inserting the game, so a bad PGN doesn't leave a game row with no moves.
      const moves = extractOpeningMoves(g.pgn, g.myColor, maxPlies);
      await db.insert(schema.games).values({
        id, source: g.source, url: g.url, username: g.username, myColor: g.myColor,
        result: g.result, timeClass: g.timeClass, endTime: g.endTime, eco: null, openingName: null,
        myRating: g.myRating, oppRating: g.oppRating, pgn: g.pgn,
      });
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
    } catch (e) {
      const message = (e as Error).message;
      skipped.push({ id, message });
      console.warn(`[ingest] skipped ${id}: ${message}`);
    }
  }
  return { gamesInserted: inserted, gameIds, skipped };
}

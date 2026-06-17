import { and, desc, eq } from "drizzle-orm";
import type { LeakOccurrence } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";

/** The user's moves matching a leak's (position-before, san) key, with their game context. */
export async function getLeakOccurrences(db: Db, epdBefore: string, san: string): Promise<LeakOccurrence[]> {
  const rows = await db.select({
    gameId: schema.moves.gameId, ply: schema.moves.ply, result: schema.games.result,
    endTime: schema.games.endTime, openingName: schema.games.openingName, myColor: schema.games.myColor,
  })
    .from(schema.moves)
    .innerJoin(schema.games, eq(schema.moves.gameId, schema.games.id))
    .where(and(eq(schema.moves.isMine, true), eq(schema.moves.epdBefore, epdBefore), eq(schema.moves.san, san)))
    .orderBy(desc(schema.games.endTime));

  return rows.map((r) => ({
    gameId: r.gameId, ply: r.ply, result: r.result as LeakOccurrence["result"],
    endTime: r.endTime, openingName: r.openingName, myColor: r.myColor as LeakOccurrence["myColor"],
  }));
}

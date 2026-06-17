import { and, eq } from "drizzle-orm";
import { scoreToCp, type GameReview, type ReviewMove, type EngineLine } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import { bestMoveSan } from "../analysis/bestMove.js";

export interface GameReviewOpts { depth: number; engineVersion: string }

/** White-POV centipawns for an EPD, given its cached eval row. Negates when Black is to move. */
export function whitePovCp(epd: string, row: { scoreCp: number | null; mateIn: number | null } | undefined): number | null {
  if (!row) return null;
  const cp = scoreToCp(row);
  return epd.split(" ")[1] === "w" ? cp : -cp;
}

export async function getGameReview(db: Db, id: string, opts: GameReviewOpts): Promise<GameReview | null> {
  const g = (await db.select().from(schema.games).where(eq(schema.games.id, id)))[0];
  if (!g) return null;

  const moveRows = (await db.select().from(schema.moves).where(eq(schema.moves.gameId, id)))
    .sort((a, b) => a.ply - b.ply);

  // Cache every eval + masters book row for this depth/version, keyed by EPD, in two queries.
  const evalRows = await db.select().from(schema.positionEvals).where(
    and(eq(schema.positionEvals.depth, opts.depth), eq(schema.positionEvals.engineVersion, opts.engineVersion)));
  const evalByEpd = new Map(evalRows.map((r) => [r.epd, r]));
  const bookRows = await db.select().from(schema.bookStats).where(eq(schema.bookStats.source, "masters"));
  const bookByEpd = new Map(bookRows.map((r) => [r.epd, r]));

  const moves: ReviewMove[] = moveRows.map((m) => {
    const beforeRow = evalByEpd.get(m.epdBefore);
    const lines: EngineLine[] = beforeRow ? (JSON.parse(beforeRow.linesJson) as EngineLine[]) : [];
    const book = bookByEpd.get(m.epdBefore);
    const bookMoves = book ? (JSON.parse(book.movesJson) as { san: string; count: number }[])
      .map((bm) => ({ san: bm.san, count: bm.count })) : [];
    return {
      ply: m.ply, san: m.san, uci: m.uci, isMine: m.isMine,
      fenBefore: m.fenBefore, fenAfter: m.fenAfter,
      bookStatus: (m.bookStatus as ReviewMove["bookStatus"]) ?? null,
      classification: (m.classification as ReviewMove["classification"]) ?? null,
      cpLoss: m.cpLoss ?? null,
      evalBeforeWhiteCp: whitePovCp(m.epdBefore, beforeRow),
      evalAfterWhiteCp: whitePovCp(m.epdAfter, evalByEpd.get(m.epdAfter)),
      engineLines: lines,
      betterMoveSan: bestMoveSan(m.fenBefore, lines),
      bookMoves,
      bookTotal: book?.total ?? 0,
    };
  });

  return {
    id: g.id, source: g.source as GameReview["source"], openingName: g.openingName, eco: g.eco,
    myColor: g.myColor as GameReview["myColor"], result: g.result as GameReview["result"],
    timeClass: g.timeClass as GameReview["timeClass"], endTime: g.endTime,
    myRating: g.myRating, oppRating: g.oppRating, moves,
  };
}

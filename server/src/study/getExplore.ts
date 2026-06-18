import { and, eq } from "drizzle-orm";
import type { ExploreResult, BookSource, EngineLine } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import { getBook } from "../book/explorerClient.js";
import { whitePovCp } from "../analysis/whitePov.js";

export interface ExploreOpts { depth: number; engineVersion: string }

/** Book stats (live + cached) plus the cached-only Stockfish eval for one position. No engine call.
 *  A book lookup failure (Lichess down / rate-limited) degrades to an empty book — never throws. */
export async function getExplore(db: Db, epd: string, source: BookSource, opts: ExploreOpts): Promise<ExploreResult> {
  let book: Awaited<ReturnType<typeof getBook>>;
  try {
    book = await getBook(db, epd, source);
  } catch {
    book = { epd, source, total: 0, moves: [] };
  }
  const evalRow = (await db.select().from(schema.positionEvals).where(
    and(eq(schema.positionEvals.epd, epd), eq(schema.positionEvals.depth, opts.depth),
      eq(schema.positionEvals.engineVersion, opts.engineVersion))))[0];
  const lines: EngineLine[] = evalRow ? (JSON.parse(evalRow.linesJson) as EngineLine[]) : [];
  return {
    epd, source, total: book.total,
    bookMoves: book.moves.map((m) => ({ san: m.san, uci: m.uci, count: m.count,
      white: m.white, draws: m.draws, black: m.black })),
    evalWhiteCp: whitePovCp(epd, evalRow),
    lines,
  };
}

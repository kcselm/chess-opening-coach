import { and, eq, gte, ne, sql } from "drizzle-orm";
import { Chess } from "chess.js";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import type { Leak, BookStatus } from "@coc/shared";

export interface LeaksOptions {
  minCpLoss: number;
  depth: number;
  engineVersion: string;
  limit: number;
}

const SCORE = sql<number>`avg(case ${schema.games.result}
  when 'win' then 1.0 when 'draw' then 0.5 else 0.0 end) * 100`;

export async function getLeaks(db: Db, opts: LeaksOptions): Promise<Leak[]> {
  const rows = await db
    .select({
      openingName: schema.games.openingName,
      eco: schema.games.eco,
      fenBefore: sql<string>`min(${schema.moves.fenBefore})`,
      epdBefore: schema.moves.epdBefore,
      yourMoveSan: schema.moves.san,
      bookStatus: sql<string>`min(${schema.moves.bookStatus})`,
      occurrences: sql<number>`count(*)`,
      avgCpLoss: sql<number>`avg(${schema.moves.cpLoss})`,
      scorePct: SCORE,
    })
    .from(schema.moves)
    .innerJoin(schema.games, eq(schema.moves.gameId, schema.games.id))
    // A leak is out-of-book AND losing eval (spec §7). bookStatus is a deterministic function of
    // (epdBefore, san) — the group keys — so it's constant within a group; ne(..,'in_book') keeps
    // novelty + unknown. Unclassified moves have null cpLoss and are already excluded by gte().
    .where(and(
      eq(schema.moves.isMine, true),
      gte(schema.moves.cpLoss, opts.minCpLoss),
      ne(schema.moves.bookStatus, "in_book"),
    ))
    .groupBy(schema.moves.epdBefore, schema.moves.san)
    .orderBy(sql`count(*) * avg(${schema.moves.cpLoss}) desc`)
    .limit(opts.limit);

  const out: Leak[] = [];
  for (const r of rows) {
    out.push({
      openingName: r.openingName ?? "Unknown opening",
      eco: r.eco,
      fenBefore: r.fenBefore,
      lineSan: "",
      yourMoveSan: r.yourMoveSan,
      betterMoveSan: await bestSanFor(db, r.epdBefore, r.fenBefore, opts),
      occurrences: Number(r.occurrences),
      avgCpLoss: Math.round(Number(r.avgCpLoss)),
      scorePct: Number(r.scorePct),
      bookStatus: (r.bookStatus as BookStatus) ?? "unknown",
    });
  }
  return out;
}

async function bestSanFor(db: Db, epd: string, fen: string, opts: LeaksOptions): Promise<string | null> {
  const rows = await db.select().from(schema.positionEvals).where(
    and(eq(schema.positionEvals.epd, epd), eq(schema.positionEvals.depth, opts.depth),
      eq(schema.positionEvals.engineVersion, opts.engineVersion)));
  const lines = rows[0] ? (JSON.parse(rows[0].linesJson) as { pvUci: string[] }[]) : [];
  const bestUci = lines[0]?.pvUci[0];
  if (!bestUci) return null;
  try {
    const chess = new Chess(fen);
    const mv = chess.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4),
      promotion: bestUci.slice(4, 5) || undefined });
    return mv.san;
  } catch { return null; }
}

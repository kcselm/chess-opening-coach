import { and, eq } from "drizzle-orm";
import type { TreeChildren, TreeChild, Color, Classification } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";

export const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";

/** Your played moves from one position, aggregated across your games of `color`. The W/D/L counts
 *  are objective outcomes from (result, color); because the tree is color-scoped they read as your
 *  own results. Pure cached reads via the moves_epd_before index. */
export async function getTreeChildren(db: Db, color: Color, epd: string = START_EPD): Promise<TreeChildren> {
  const rows = await db.select({
    san: schema.moves.san, uci: schema.moves.uci, epdAfter: schema.moves.epdAfter,
    isMine: schema.moves.isMine, classification: schema.moves.classification, cpLoss: schema.moves.cpLoss,
    result: schema.games.result,
  })
    .from(schema.moves)
    .innerJoin(schema.games, eq(schema.moves.gameId, schema.games.id))
    .where(and(eq(schema.games.myColor, color), eq(schema.moves.epdBefore, epd)));

  interface Agg {
    san: string; uci: string; epdAfter: string; isMine: boolean; classification: string | null;
    cpLossSum: number; cpLossN: number; count: number; white: number; draws: number; black: number;
  }
  const byUci = new Map<string, Agg>();

  for (const r of rows) {
    let a = byUci.get(r.uci);
    if (!a) {
      a = { san: r.san, uci: r.uci, epdAfter: r.epdAfter, isMine: r.isMine, classification: r.classification,
        cpLossSum: 0, cpLossN: 0, count: 0, white: 0, draws: 0, black: 0 };
      byUci.set(r.uci, a);
    }
    a.count++;
    if (r.classification && !a.classification) a.classification = r.classification;
    if (r.cpLoss !== null) { a.cpLossSum += r.cpLoss; a.cpLossN++; }
    if (r.result === "draw") a.draws++;
    else if ((color === "white") === (r.result === "win")) a.white++;
    else a.black++;
  }

  const children: TreeChild[] = [...byUci.values()].map((a) => ({
    san: a.san, uci: a.uci, epdAfter: a.epdAfter, count: a.count, isMine: a.isMine,
    classification: (a.classification as Classification | null) ?? null,
    avgCpLoss: a.cpLossN ? a.cpLossSum / a.cpLossN : null,
    white: a.white, draws: a.draws, black: a.black,
  })).sort((x, y) => y.count - x.count);

  return { epd, color, children };
}

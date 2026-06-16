import { Chess } from "chess.js";
import { toEpd } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";

export interface OpeningRow { eco: string; name: string; pgn: string }

export function rowToEpd(pgn: string): string {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return toEpd(chess.fen());
}

export async function seedOpenings(db: Db, rows: OpeningRow[]): Promise<number> {
  await db.delete(schema.openings);
  let n = 0;
  for (const r of rows) {
    await db.insert(schema.openings).values({ epd: rowToEpd(r.pgn), eco: r.eco, name: r.name })
      .onConflictDoNothing();
    n++;
  }
  return n;
}

export async function loadOpeningTable(db: Db): Promise<Map<string, { eco: string; name: string }>> {
  const rows = await db.select().from(schema.openings);
  return new Map(rows.map((r) => [r.epd, { eco: r.eco, name: r.name }]));
}

export { pickOpening } from "./namer.js";

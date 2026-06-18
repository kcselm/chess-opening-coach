import { or, like } from "drizzle-orm";
import type { OpeningListItem } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";

/** Openings whose name or ECO contains `q` (SQLite LIKE — ASCII case-insensitive), name-ordered, capped. */
export async function searchOpenings(db: Db, q: string, limit = 50): Promise<OpeningListItem[]> {
  const term = `%${q}%`;
  const rows = await db.select().from(schema.openings)
    .where(or(like(schema.openings.name, term), like(schema.openings.eco, term)))
    .orderBy(schema.openings.name)
    .limit(limit);
  return rows.map((r) => ({ epd: r.epd, eco: r.eco, name: r.name }));
}

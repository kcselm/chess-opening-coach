import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";

export type BookSource = "masters" | "rating";

export interface BookMove { san: string; uci: string; count: number; white: number; draws: number; black: number }
export interface Book { epd: string; source: BookSource; total: number; moves: BookMove[] }

interface ExplorerResponse {
  white: number; draws: number; black: number;
  moves: { uci: string; san: string; white: number; draws: number; black: number }[];
}

export interface GetBookOpts {
  fetchFn?: typeof fetch;
  now?: () => number;
  ratings?: number[];
}

export async function getBook(db: Db, epd: string, source: BookSource, opts: GetBookOpts = {}): Promise<Book> {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));

  const cached = await db.select().from(schema.bookStats)
    .where(and(eq(schema.bookStats.epd, epd), eq(schema.bookStats.source, source)));
  if (cached[0]) {
    return { epd, source, total: cached[0].total, moves: JSON.parse(cached[0].movesJson) };
  }

  const fen = `${epd} 0 1`;
  const base = source === "masters" ? "https://explorer.lichess.ovh/masters" : "https://explorer.lichess.ovh/lichess";
  const params = new URLSearchParams({ fen });
  if (source === "rating") {
    params.set("speeds", "blitz,rapid,classical");
    params.set("ratings", (opts.ratings ?? [1600, 1800, 2000]).join(","));
  }
  const res = await fetchFn(`${base}?${params.toString()}`);
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  const data = (await res.json()) as ExplorerResponse;

  const moves: BookMove[] = data.moves.map((m) => ({
    san: m.san, uci: m.uci, count: m.white + m.draws + m.black,
    white: m.white, draws: m.draws, black: m.black,
  }));
  const total = data.white + data.draws + data.black;

  await db.insert(schema.bookStats).values({
    epd, source, total, movesJson: JSON.stringify(moves), fetchedAt: now(),
  });
  return { epd, source, total, moves };
}

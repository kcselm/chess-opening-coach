import type { NormalizedGame, TimeClass, GameResult } from "@coc/shared";
import type { FetchParams, GameSource } from "./types.js";

const DRAW_RESULTS = new Set([
  "agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient",
]);

interface ChesscomPlayer { username: string; rating?: number; result: string }
interface ChesscomGame {
  url: string; pgn: string; time_class: string; rules: string; end_time: number;
  white: ChesscomPlayer; black: ChesscomPlayer;
}

function resultFor(my: ChesscomPlayer): GameResult {
  if (my.result === "win") return "win";
  if (DRAW_RESULTS.has(my.result)) return "draw";
  return "loss";
}

export function normalizeChesscomGames(
  games: ChesscomGame[], username: string, timeClasses: TimeClass[]
): NormalizedGame[] {
  const uname = username.toLowerCase();
  const allowed = new Set(timeClasses);
  const out: NormalizedGame[] = [];
  for (const g of games) {
    if (g.rules !== "chess") continue;
    if (!allowed.has(g.time_class as TimeClass)) continue;
    const iAmWhite = g.white.username.toLowerCase() === uname;
    const me = iAmWhite ? g.white : g.black;
    const opp = iAmWhite ? g.black : g.white;
    out.push({
      source: "chesscom",
      sourceGameId: g.url.split("/").pop() ?? g.url,
      url: g.url,
      username,
      myColor: iAmWhite ? "white" : "black",
      result: resultFor(me),
      timeClass: g.time_class as TimeClass,
      endTime: g.end_time,
      myRating: me.rating ?? null,
      oppRating: opp.rating ?? null,
      pgn: g.pgn,
    });
  }
  return out;
}

export class ChesscomSource implements GameSource {
  id = "chesscom" as const;
  async *fetchGames(params: FetchParams): AsyncIterable<NormalizedGame> {
    const months = monthsBetween(params.since, params.until);
    for (const { year, month } of months) {
      const url = `https://api.chess.com/pub/player/${params.username}/games/${year}/${month}`;
      const res = await fetch(url, { headers: { "User-Agent": "chess-opening-coach" } });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`chess.com ${res.status} for ${url}`);
      const data = (await res.json()) as { games: ChesscomGame[] };
      for (const g of normalizeChesscomGames(data.games, params.username, params.timeClasses)) {
        if (g.endTime >= params.since && g.endTime <= params.until) yield g;
      }
    }
  }
}

function monthsBetween(since: number, until: number): { year: string; month: string }[] {
  const out: { year: string; month: string }[] = [];
  const start = new Date(since * 1000);
  const end = new Date(until * 1000);
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (d <= end) {
    out.push({ year: String(d.getUTCFullYear()), month: String(d.getUTCMonth() + 1).padStart(2, "0") });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

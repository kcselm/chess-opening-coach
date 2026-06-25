import type { NormalizedGame, TimeClass, GameResult } from "@coc/shared";
import type { FetchParams, GameSource } from "./types.js";

// Lichess "speed" -> our TimeClass
const SPEED_TO_CLASS: Record<string, TimeClass> = {
  ultraBullet: "bullet",
  bullet: "bullet",
  blitz: "blitz",
  rapid: "rapid",
  classical: "classical",
  correspondence: "daily",
};

// our TimeClass -> Lichess perfTypes (for the API query)
const CLASS_TO_PERFS: Record<TimeClass, string[]> = {
  bullet: ["ultraBullet", "bullet"],
  blitz: ["blitz"],
  rapid: ["rapid"],
  classical: ["classical"],
  daily: ["correspondence"],
};

interface LichessPlayer { user?: { name?: string }; rating?: number }
interface LichessGame {
  id: string;
  variant: string;
  speed: string;
  createdAt: number;
  lastMoveAt: number;
  winner?: "white" | "black";
  players: { white: LichessPlayer; black: LichessPlayer };
  pgn: string;
}

export function normalizeLichessGames(
  games: LichessGame[], username: string, timeClasses: TimeClass[]
): NormalizedGame[] {
  const uname = username.toLowerCase();
  const allowed = new Set(timeClasses);
  const out: NormalizedGame[] = [];
  for (const g of games) {
    if (g.variant !== "standard") continue;
    const timeClass = SPEED_TO_CLASS[g.speed];
    if (!timeClass || !allowed.has(timeClass)) continue;
    const iAmWhite = g.players.white.user?.name?.toLowerCase() === uname;
    const iAmBlack = g.players.black.user?.name?.toLowerCase() === uname;
    if (!iAmWhite && !iAmBlack) continue; // can't identify my color — skip defensively
    const me = iAmWhite ? g.players.white : g.players.black;
    const opp = iAmWhite ? g.players.black : g.players.white;
    const myColor = iAmWhite ? "white" : "black";
    const result: GameResult = !g.winner ? "draw" : g.winner === myColor ? "win" : "loss";
    out.push({
      source: "lichess",
      sourceGameId: g.id,
      url: `https://lichess.org/${g.id}`,
      username,
      myColor,
      result,
      timeClass,
      endTime: Math.floor(g.lastMoveAt / 1000),
      myRating: me.rating ?? null,
      oppRating: opp.rating ?? null,
      pgn: g.pgn,
    });
  }
  return out;
}

export class LichessSource implements GameSource {
  id = "lichess" as const;
  constructor(private token?: string) {}

  async *fetchGames(params: FetchParams): AsyncIterable<NormalizedGame> {
    const perfs = [...new Set(params.timeClasses.flatMap((c) => CLASS_TO_PERFS[c]))];
    const url = new URL(`https://lichess.org/api/games/user/${params.username}`);
    url.searchParams.set("since", String(params.since * 1000)); // FetchParams is seconds; Lichess wants ms
    url.searchParams.set("until", String(params.until * 1000));
    url.searchParams.set("perfType", perfs.join(","));
    url.searchParams.set("pgnInJson", "true");
    url.searchParams.set("clocks", "false");
    url.searchParams.set("evals", "false");
    url.searchParams.set("opening", "false");

    const headers: Record<string, string> = {
      Accept: "application/x-ndjson",
      "User-Agent": "chess-opening-coach",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetchWithBackoff(url.toString(), { headers });
    if (res.status === 404) return; // username not found -> empty stream
    if (!res.ok) throw new Error(`lichess ${res.status} for ${url.pathname}`);
    if (!res.body) return;

    for await (const line of ndjsonLines(res.body)) {
      let game: LichessGame;
      try { game = JSON.parse(line) as LichessGame; } catch { continue; } // skip a malformed line
      for (const g of normalizeLichessGames([game], params.username, params.timeClasses)) {
        if (g.endTime >= params.since && g.endTime <= params.until) yield g;
      }
    }
  }
}

async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield line;
    }
  }
  const last = buf.trim();
  if (last) yield last;
}

async function fetchWithBackoff(url: string, init: RequestInit, tries = 3): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= tries) return res;
    const retryAfter = Number(res.headers.get("Retry-After")) || 2 ** attempt;
    await new Promise((r) => setTimeout(r, retryAfter * 1000)); // respect Retry-After, else exp backoff
  }
}

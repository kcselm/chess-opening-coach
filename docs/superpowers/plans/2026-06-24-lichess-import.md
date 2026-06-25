# Lichess Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Lichess as a second game source alongside chess.com, selectable from the Dashboard.

**Architecture:** Ingest/analysis/classification already consume `NormalizedGame` through the `GameSource` adapter interface, so this is four focused changes: widen the `SyncRequest.source` enum, add a `LichessSource` adapter (NDJSON stream + a pure `normalizeLichessGames` mapper), pick the adapter via a small `sourceFor` factory at the sync call site, and add a source toggle to the Dashboard.

**Tech Stack:** TypeScript, Zod, Hono (server), React + Vite + TanStack (web), Vitest + Testing Library.

**Design spec:** `docs/superpowers/specs/2026-06-24-lichess-import-design.md`

## Global Constraints

- Node `>=22`; ESM throughout. Relative imports use the `.js` extension even for `.ts` files (NodeNext resolution).
- `@coc/shared` resolves to `shared/src/index.ts` directly — no build step is needed for schema changes to reach the server/web typechecks.
- **Never** `git add -A` / `git add .`. Stage files explicitly. `server/engine/` is an untracked Stockfish binary and must never be committed.
- Full verification is tests **plus** typechecks (Vitest uses esbuild and does not surface type errors): `npx tsc -p server/tsconfig.json --noEmit` and `npx tsc -p web/tsconfig.json --noEmit`. The server's `engineManager.integration.test.ts` is skipped without the binary — **1 skip is expected**.
- Do this work on a feature branch (e.g. `feat/lichess-import`), not directly on `master`.
- Standard chess only — non-standard variants are skipped, matching the chess.com adapter.

---

### Task 1: Widen `SyncRequest.source` to allow `"lichess"`

**Files:**
- Modify: `shared/src/schemas.ts:50` (the `SyncRequest.source` field)
- Test: `shared/src/schemas.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SyncRequest` now parses `{ source: "lichess", ... }`. The `source` field type becomes `"chesscom" | "lichess"`.

- [ ] **Step 1: Write the failing test**

Add this `describe` block to the end of `shared/src/schemas.test.ts`:

```ts
import { SyncRequest } from "./schemas.js"; // add to the existing import line at the top

describe("SyncRequest source", () => {
  const base = { username: "me", since: 1, until: 2, timeClasses: ["blitz"] as const };
  it("accepts chesscom and lichess", () => {
    expect(SyncRequest.parse({ ...base, source: "chesscom" }).source).toBe("chesscom");
    expect(SyncRequest.parse({ ...base, source: "lichess" }).source).toBe("lichess");
  });
  it("rejects an unknown source", () => {
    expect(() => SyncRequest.parse({ ...base, source: "bughouse" })).toThrow();
  });
});
```

(Place the `SyncRequest` import on the existing first `import ... from "./schemas.js"` line rather than duplicating it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/shared -- schemas`
Expected: FAIL — the "accepts chesscom and lichess" case throws because `"lichess"` is not in the enum.

- [ ] **Step 3: Make the change**

In `shared/src/schemas.ts`, replace the `source` line inside `SyncRequest`:

```ts
// before
  source: z.enum(["chesscom"]), // lichess source lands in Phase 2; MVP syncs chess.com only
// after
  source: z.enum(["chesscom", "lichess"]),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @coc/shared -- schemas`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck shared**

Run: `npx tsc -p shared/tsconfig.json --noEmit`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add shared/src/schemas.ts shared/src/schemas.test.ts
git commit -m "feat(shared): allow lichess as a SyncRequest source"
```

---

### Task 2: Lichess adapter (`normalizeLichessGames` + `LichessSource`)

**Files:**
- Create: `server/test/fixtures/lichess-games.json`
- Create: `server/src/sources/lichess.ts`
- Test: `server/src/sources/lichess.test.ts`

**Interfaces:**
- Consumes: `NormalizedGame`, `TimeClass`, `GameResult` from `@coc/shared`; `FetchParams`, `GameSource` from `./types.js`.
- Produces:
  - `normalizeLichessGames(games: LichessGame[], username: string, timeClasses: TimeClass[]): NormalizedGame[]` — pure mapper.
  - `class LichessSource implements GameSource` with `id = "lichess"` and `constructor(token?: string)`.

- [ ] **Step 1: Create the fixture**

Create `server/test/fixtures/lichess-games.json` (an array of parsed Lichess game objects — the shape `normalizeLichessGames` receives after NDJSON parsing):

```json
[
  {
    "id": "g1", "variant": "standard", "speed": "blitz",
    "createdAt": 1700000000000, "lastMoveAt": 1700000300000, "winner": "white",
    "players": {
      "white": { "user": { "name": "Me" }, "rating": 1500 },
      "black": { "user": { "name": "Opp" }, "rating": 1490 }
    },
    "pgn": "[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0"
  },
  {
    "id": "g2", "variant": "standard", "speed": "rapid",
    "createdAt": 1700099000000, "lastMoveAt": 1700100000000,
    "players": {
      "white": { "user": { "name": "Opp" }, "rating": 1600 },
      "black": { "user": { "name": "me" }, "rating": 1550 }
    },
    "pgn": "[Result \"1/2-1/2\"]\n\n1. d4 d5 1/2-1/2"
  },
  {
    "id": "g3", "variant": "chess960", "speed": "blitz",
    "createdAt": 1700199000000, "lastMoveAt": 1700200000000, "winner": "white",
    "players": {
      "white": { "user": { "name": "Me" }, "rating": 1500 },
      "black": { "user": { "name": "Opp" }, "rating": 1400 }
    },
    "pgn": "1. e4 1-0"
  },
  {
    "id": "g4", "variant": "standard", "speed": "ultraBullet",
    "createdAt": 1700299000000, "lastMoveAt": 1700300000000, "winner": "black",
    "players": {
      "white": { "user": { "name": "me" }, "rating": 1400 },
      "black": { "user": { "name": "Opp" }, "rating": 1450 }
    },
    "pgn": "[Result \"0-1\"]\n\n1. f3 e5 0-1"
  },
  {
    "id": "g5", "variant": "standard", "speed": "correspondence",
    "createdAt": 1700399000000, "lastMoveAt": 1700400000000, "winner": "white",
    "players": {
      "white": { "user": { "name": "me" }, "rating": 1700 },
      "black": { "user": { "name": "Opp" }, "rating": 1680 }
    },
    "pgn": "[Result \"1-0\"]\n\n1. e4 c5 1-0"
  },
  {
    "id": "g6", "variant": "standard", "speed": "classical",
    "createdAt": 1700499000000, "lastMoveAt": 1700500000000, "winner": "white",
    "players": {
      "white": { "user": { "name": "me" }, "rating": 1720 },
      "black": { "user": { "name": "Opp" }, "rating": 1700 }
    },
    "pgn": "[Result \"1-0\"]\n\n1. d4 d5 1-0"
  }
]
```

- [ ] **Step 2: Write the failing test**

Create `server/src/sources/lichess.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeLichessGames } from "./lichess.js";

const games = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../test/fixtures/lichess-games.json", import.meta.url)), "utf8")
);

describe("normalizeLichessGames", () => {
  // request order intentionally excludes "classical" to prove time-class filtering
  const out = normalizeLichessGames(games, "me", ["blitz", "rapid", "bullet", "daily"]);

  it("keeps only standard games in allowed (mapped) time classes", () => {
    expect(out).toHaveLength(4);
    expect(out.some((g) => g.sourceGameId === "g3")).toBe(false); // chess960 variant
    expect(out.some((g) => g.timeClass === "classical")).toBe(false); // not requested
  });

  it("maps my color and result case-insensitively, incl. a draw", () => {
    expect(out[0]).toMatchObject({ source: "lichess", sourceGameId: "g1", url: "https://lichess.org/g1",
      myColor: "white", result: "win", timeClass: "blitz", myRating: 1500, oppRating: 1490 });
    expect(out[1]).toMatchObject({ myColor: "black", result: "draw", timeClass: "rapid",
      myRating: 1550, oppRating: 1600 });
  });

  it("maps a loss and the ultraBullet->bullet speed", () => {
    expect(out[2]).toMatchObject({ sourceGameId: "g4", myColor: "white", result: "loss", timeClass: "bullet" });
  });

  it("maps correspondence->daily and ms->s endTime", () => {
    expect(out[3]).toMatchObject({ sourceGameId: "g5", timeClass: "daily", result: "win" });
    expect(out[0].endTime).toBe(1700000300); // 1700000300000 ms / 1000
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w @coc/server -- lichess`
Expected: FAIL — `normalizeLichessGames` is not defined / `./lichess.js` has no such export.

- [ ] **Step 4: Write the implementation**

Create `server/src/sources/lichess.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @coc/server -- lichess`
Expected: PASS (all four cases).

- [ ] **Step 6: Typecheck server**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: no output (exit 0).

- [ ] **Step 7: Commit**

```bash
git add server/src/sources/lichess.ts server/src/sources/lichess.test.ts server/test/fixtures/lichess-games.json
git commit -m "feat(server): add Lichess GameSource adapter"
```

---

### Task 3: Source factory + wire into the sync run

**Files:**
- Create: `server/src/sources/factory.ts`
- Test: `server/src/sources/factory.test.ts`
- Modify: `server/src/index.ts:8` (import) and `server/src/index.ts:46` (source construction)
- Modify: `server/.env.example`

**Interfaces:**
- Consumes: `ChesscomSource` from `./chesscom.js`, `LichessSource` from `./lichess.js`, `GameSource` from `./types.js`.
- Produces: `sourceFor(source: "chesscom" | "lichess", token?: string): GameSource`.

- [ ] **Step 1: Write the failing test**

Create `server/src/sources/factory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sourceFor } from "./factory.js";

describe("sourceFor", () => {
  it("returns a chess.com adapter for chesscom", () => {
    expect(sourceFor("chesscom").id).toBe("chesscom");
  });
  it("returns a Lichess adapter for lichess", () => {
    expect(sourceFor("lichess", "tok").id).toBe("lichess");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/server -- factory`
Expected: FAIL — `./factory.js` / `sourceFor` does not exist.

- [ ] **Step 3: Write the factory**

Create `server/src/sources/factory.ts`:

```ts
import type { GameSource } from "./types.js";
import { ChesscomSource } from "./chesscom.js";
import { LichessSource } from "./lichess.js";

export function sourceFor(source: "chesscom" | "lichess", token?: string): GameSource {
  return source === "lichess" ? new LichessSource(token) : new ChesscomSource();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/server -- factory`
Expected: PASS.

- [ ] **Step 5: Wire it into the sync run**

In `server/src/index.ts`, replace the ChesscomSource import (line ~8):

```ts
// before
import { ChesscomSource } from "./sources/chesscom.js";
// after
import { sourceFor } from "./sources/factory.js";
```

Then replace the source construction inside `startSync` (line ~46):

```ts
// before
    const source = new ChesscomSource();
// after
    const source = sourceFor(req.source, process.env.LICHESS_TOKEN);
```

- [ ] **Step 6: Document the optional token**

Append to `server/.env.example`:

```
# Optional Lichess API token — only needed to raise rate limits; Lichess import works without it.
LICHESS_TOKEN=
```

- [ ] **Step 7: Typecheck server**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: no output (exit 0). Confirms `ChesscomSource` is no longer referenced unused in `index.ts` and `sourceFor` is wired correctly.

- [ ] **Step 8: Commit**

```bash
git add server/src/sources/factory.ts server/src/sources/factory.test.ts server/src/index.ts server/.env.example
git commit -m "feat(server): pick game source by request via sourceFor factory"
```

---

### Task 4: Dashboard source toggle

**Files:**
- Modify: `web/src/routes/dashboard.tsx`
- Test: `web/src/routes/dashboard.test.tsx`

**Interfaces:**
- Consumes: `api.sync.$post` (existing), `SyncProgress` component (existing).
- Produces: a `<select aria-label="Source">` whose value (`"chesscom" | "lichess"`) is sent as `source` in the sync request.

- [ ] **Step 1: Write the failing test**

Create `web/src/routes/dashboard.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const post = vi.fn(async () => ({ json: async () => ({ runId: "r1" }) }));
vi.mock("../api/client.js", () => ({ api: { sync: { $post: (...a: unknown[]) => post(...a) } } }));
vi.mock("../components/SyncProgress.js", () => ({
  SyncProgress: ({ runId }: { runId: string }) => <div>progress {runId}</div>,
}));

async function renderPage() {
  const { DashboardPage } = await import("./dashboard.js");
  render(<DashboardPage />);
}

describe("DashboardPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("syncs the selected source with the entered username", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "lichess" } });
    fireEvent.change(screen.getByPlaceholderText(/username/), { target: { value: "magnus" } });
    fireEvent.click(screen.getByText(/Sync/));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const arg = post.mock.calls[0][0] as { json: { source: string; username: string } };
    expect(arg.json).toMatchObject({ source: "lichess", username: "magnus" });
    await waitFor(() => expect(screen.getByText(/progress r1/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- dashboard`
Expected: FAIL — there is no element with `aria-label="Source"` yet (`getByLabelText("Source")` throws).

- [ ] **Step 3: Update the Dashboard**

Replace the entire contents of `web/src/routes/dashboard.tsx` with:

```tsx
import { useState } from "react";
import { api } from "../api/client.js";
import { SyncProgress } from "../components/SyncProgress.js";

type Source = "chesscom" | "lichess";
const SOURCE_LABELS: Record<Source, string> = { chesscom: "chess.com", lichess: "Lichess" };

export function DashboardPage() {
  const [source, setSource] = useState<Source>("chesscom");
  const [username, setUsername] = useState("");
  const [runId, setRunId] = useState<string | null>(null);

  async function startSync() {
    const now = Math.floor(Date.now() / 1000);
    const res = await api.sync.$post({
      json: { source, username, since: now - 60 * 60 * 24 * 90, until: now,
        timeClasses: ["rapid", "blitz", "classical"] },
    });
    const { runId } = (await res.json()) as { runId: string };
    setRunId(runId);
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Analyze the last 90 days of your games.</p>
      <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as Source)}>
        <option value="chesscom">chess.com</option>
        <option value="lichess">Lichess</option>
      </select>
      <input placeholder={`${SOURCE_LABELS[source]} username`} value={username}
        onChange={(e) => setUsername(e.target.value)} />
      <button onClick={startSync} disabled={!username}>Sync &amp; analyze</button>
      {runId && <SyncProgress runId={runId} />}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/web -- dashboard`
Expected: PASS.

- [ ] **Step 5: Typecheck web**

Run: `npx tsc -p web/tsconfig.json --noEmit`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/dashboard.tsx web/src/routes/dashboard.test.tsx
git commit -m "feat(web): Dashboard source toggle for chess.com / Lichess"
```

---

### Task 5: Update README status and full verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: docs reflect that Lichess import has landed.

- [ ] **Step 1: Update the status note**

In `README.md`, replace the status block (lines ~8–12):

```markdown
> **Status:** Phases 0–4. Imports chess.com games, analyzes openings, and shows the leak
> report, repertoire **Tree**, per-game **Review**, **Study** (browse a line over book +
> our eval), and **Drill** (rehearse a picked opening against a book opponent, graded by
> the same rule as the leak report). Lichess import is still pending (see
> `docs/superpowers/specs/2026-06-15-chess-opening-coach-design.md`).
```

with:

```markdown
> **Status:** Phases 0–4. Imports chess.com **and Lichess** games, analyzes openings, and
> shows the leak report, repertoire **Tree**, per-game **Review**, **Study** (browse a line
> over book + our eval), and **Drill** (rehearse a picked opening against a book opponent,
> graded by the same rule as the leak report).
```

- [ ] **Step 2: Update the Run instruction**

In `README.md`, replace the sync instruction line (~line 45):

```markdown
In the **Dashboard**, enter your chess.com username and click **Sync & analyze**;
watch progress reach `done`, then open **Leaks** for the ranked report.
```

with:

```markdown
In the **Dashboard**, pick a source (chess.com or Lichess), enter your username and click
**Sync & analyze**; watch progress reach `done`, then open **Leaks** for the ranked report.
For Lichess you may optionally set `LICHESS_TOKEN` in `server/.env` to raise rate limits.
```

- [ ] **Step 3: Run the full suite**

Run each and confirm:

```bash
npm run test -w @coc/shared
npm run test -w @coc/server
npm run test -w @coc/web
```

Expected: all green. The server suite reports **1 skipped** (`engineManager.integration.test.ts`) — that is normal without the Stockfish binary.

- [ ] **Step 4: Run the typechecks**

```bash
npx tsc -p shared/tsconfig.json --noEmit
npx tsc -p server/tsconfig.json --noEmit
npx tsc -p web/tsconfig.json --noEmit
```

Expected: no output from any (exit 0).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README reflects Lichess import"
```

---

## Self-Review Notes

- **Spec coverage:** §4.1 schema → Task 1; §4.2 adapter (mapping tables, field map, filters, streaming, auth, backoff) → Task 2; §4.3 factory + `LICHESS_TOKEN` env → Task 3; §4.4 Dashboard toggle → Task 4; §5 error handling (404 empty / 429 backoff / non-OK throw / malformed-line skip) → Task 2; §6 testing → Tasks 1–4 fixtures/tests. README status (parent README) → Task 5.
- **Out of scope (per spec §7), intentionally absent:** date-range/time-class UI, OAuth, variant/study import, eval fast-path.
- **Type consistency:** `normalizeLichessGames` and `LichessSource` signatures are identical across Task 2's definition and Task 3's `sourceFor` consumption; `sourceFor(source, token?)` matches its call in `index.ts`. `TimeClass` values used (`bullet/blitz/rapid/classical/daily`) match the `shared` enum.
- **Note:** `LichessSource.fetchGames` (network streaming + backoff) is verified by typecheck and the manual end-to-end smoke, not by a unit test — mirroring how the chess.com adapter's `fetchGames` is left to integration/manual while the pure `normalize*` function carries the unit coverage.
```

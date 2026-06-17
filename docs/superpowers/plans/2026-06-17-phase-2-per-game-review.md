# Per-game Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Games list view and a per-game Review screen that steps through a game's opening phase showing each move's Stockfish verdict, engine lines, book stats, and a White-POV eval graph — plus a leak→Review deep-link.

**Architecture:** The backend shapes already-cached data (`position_evals`, `book_stats`, `moves`) into one enriched `GameReview` payload per game (no new engine work) and adds a lazy `/leaks/occurrences` lookup. The frontend renders a pure `ReviewWorkspace` (board + eval bar + move list + SVG eval graph + position panel) driven by a single current-ply index, wrapped by thin route components. All eval values exposed to the UI are normalized to White's point of view.

**Tech Stack:** TypeScript, Hono + Drizzle/libSQL (server), React + TanStack Router/Query + chess.js + chessground (web), Zod (shared), Vitest + Testing Library.

## Global Constraints

- Node `>=22`; npm-workspaces monorepo (`@coc/shared`, `@coc/server`, `@coc/web`).
- ESM throughout: relative imports use the `.js` extension even from `.ts`/`.tsx` sources.
- Cross-boundary payloads are Zod schemas in `@coc/shared`, validated at the web boundary (mirror the existing `Leak` pattern).
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Review covers the **opening phase only** — exactly the plies in the `moves` table. No new engine calls; Review is pure cached reads.
- Eval values shown in the UI are **White-POV centipawns**, derived from `position_evals` normalized by the active color in the EPD. Do **not** use the `moves.eval_played_cp` column for the graph/bar (it is mover-relative and only set for the user's moves).
- Test commands: server `npm run test -w @coc/server`; web `npm run test -w @coc/web`; shared `npm run test -w @coc/shared`. A trailing `-- <path>` filters to one file.

---

### Task 0: Land the in-flight Phase 1 robustness fixes

The working tree holds uncommitted Phase 1 fixes (concurrency guard in `routes/app.ts`/`index.ts`, resumable progress in `analysis/orchestrator.ts`, book-fetch timeout in `book/explorerClient.ts`) with their tests. Commit them so this cycle starts clean.

**Files:**
- Modify (commit as-is): `server/src/analysis/orchestrator.ts`, `server/src/analysis/orchestrator.test.ts`, `server/src/book/explorerClient.ts`, `server/src/book/explorerClient.test.ts`, `server/src/index.ts`, `server/src/routes/app.ts`, `server/src/routes/app.test.ts`

- [ ] **Step 1: Run the server suite to confirm the working tree is green**

Run: `npm run test -w @coc/server`
Expected: PASS (all files, including the modified `orchestrator.test.ts`, `explorerClient.test.ts`, `app.test.ts`).

- [ ] **Step 2: Commit the robustness fixes**

```bash
git add server/src/analysis/orchestrator.ts server/src/analysis/orchestrator.test.ts \
  server/src/book/explorerClient.ts server/src/book/explorerClient.test.ts \
  server/src/index.ts server/src/routes/app.ts server/src/routes/app.test.ts
git commit -m "fix(server): concurrency guard, resumable progress, book-fetch timeout"
```

---

### Task 1: Shared schemas for games & review

**Files:**
- Modify: `shared/src/schemas.ts`
- Test: `shared/src/schemas.test.ts` (create)

**Interfaces:**
- Consumes: existing `Color`, `GameResult`, `TimeClass`, `BookStatus`, `Classification`, `EngineLine` from this file.
- Produces: `GameSummary`, `ReviewMove`, `GameReview`, `LeakOccurrence` schemas + inferred types, exported from `@coc/shared`.

- [ ] **Step 1: Write the failing test**

Create `shared/src/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GameSummary, GameReview, LeakOccurrence, ReviewMove } from "./schemas.js";

describe("phase-2 schemas", () => {
  it("parses a GameSummary", () => {
    const v = {
      id: "g1", source: "chesscom", openingName: "Sicilian Defense", eco: "B20",
      myColor: "white", result: "loss", timeClass: "rapid", endTime: 1,
      myRating: 1500, oppRating: 1490,
    };
    expect(GameSummary.parse(v)).toEqual(v);
  });

  it("parses a ReviewMove with nullable evals and engine lines", () => {
    const v = {
      ply: 1, san: "e4", uci: "e2e4", isMine: true,
      fenBefore: "F0", fenAfter: "F1", bookStatus: "in_book", classification: "book",
      cpLoss: 0, evalBeforeWhiteCp: 20, evalAfterWhiteCp: 25,
      engineLines: [{ rank: 1, scoreCp: 25, mateIn: null, pvUci: ["e2e4"] }],
      betterMoveSan: "e4", bookMoves: [{ san: "e4", count: 100 }], bookTotal: 120,
    };
    expect(ReviewMove.parse(v)).toEqual(v);
    expect(ReviewMove.parse({ ...v, evalBeforeWhiteCp: null, classification: null }).evalBeforeWhiteCp).toBeNull();
  });

  it("parses GameReview and LeakOccurrence", () => {
    const review = {
      id: "g1", source: "chesscom", openingName: null, eco: null, myColor: "black",
      result: "win", timeClass: "blitz", endTime: 2, myRating: null, oppRating: null, moves: [],
    };
    expect(GameReview.parse(review).moves).toEqual([]);
    const occ = { gameId: "g1", ply: 4, result: "loss", endTime: 9, openingName: "X", myColor: "white" };
    expect(LeakOccurrence.parse(occ)).toEqual(occ);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/shared -- src/schemas.test.ts`
Expected: FAIL — `GameSummary`/`ReviewMove`/`GameReview`/`LeakOccurrence` are not exported.

- [ ] **Step 3: Add the schemas**

Append to `shared/src/schemas.ts`:

```ts
export const GameSummary = z.object({
  id: z.string(),
  source: z.enum(["chesscom", "lichess"]),
  openingName: z.string().nullable(),
  eco: z.string().nullable(),
  myColor: Color,
  result: GameResult,
  timeClass: TimeClass,
  endTime: z.number().int(),
  myRating: z.number().int().nullable(),
  oppRating: z.number().int().nullable(),
});
export type GameSummary = z.infer<typeof GameSummary>;

export const ReviewMove = z.object({
  ply: z.number().int(),
  san: z.string(),
  uci: z.string(),
  isMine: z.boolean(),
  fenBefore: z.string(),
  fenAfter: z.string(),
  bookStatus: BookStatus.nullable(),
  classification: Classification.nullable(),
  cpLoss: z.number().int().nullable(),
  // White-POV evals of the positions before/after this ply; null when the position has no cached eval.
  evalBeforeWhiteCp: z.number().int().nullable(),
  evalAfterWhiteCp: z.number().int().nullable(),
  engineLines: z.array(EngineLine),
  betterMoveSan: z.string().nullable(),
  bookMoves: z.array(z.object({ san: z.string(), count: z.number().int() })),
  bookTotal: z.number().int(),
});
export type ReviewMove = z.infer<typeof ReviewMove>;

export const GameReview = GameSummary.extend({
  moves: z.array(ReviewMove),
});
export type GameReview = z.infer<typeof GameReview>;

export const LeakOccurrence = z.object({
  gameId: z.string(),
  ply: z.number().int(),
  result: GameResult,
  endTime: z.number().int(),
  openingName: z.string().nullable(),
  myColor: Color,
});
export type LeakOccurrence = z.infer<typeof LeakOccurrence>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/shared -- src/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/schemas.ts shared/src/schemas.test.ts
git commit -m "feat(shared): GameSummary/ReviewMove/GameReview/LeakOccurrence schemas"
```

---

### Task 2: Extract `bestMoveSan` helper; refactor leaks to use it

**Files:**
- Create: `server/src/analysis/bestMove.ts`
- Test: `server/src/analysis/bestMove.test.ts` (create)
- Modify: `server/src/leaks/leaksQuery.ts` (replace the chess.js move logic inside `bestSanFor`)

**Interfaces:**
- Produces: `bestMoveSan(fen: string, lines: { pvUci: string[] }[]): string | null` — SAN of the first PV's first move, or `null` if no line / illegal.
- Consumes: nothing new. `leaksQuery.bestSanFor` keeps its `(db, epd, fen, opts)` signature and output.

- [ ] **Step 1: Write the failing test**

Create `server/src/analysis/bestMove.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bestMoveSan } from "./bestMove.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("bestMoveSan", () => {
  it("derives SAN from the first PV move", () => {
    expect(bestMoveSan(START, [{ pvUci: ["g1f3"] }])).toBe("Nf3");
  });
  it("returns null when there is no line", () => {
    expect(bestMoveSan(START, [])).toBeNull();
  });
  it("returns null for an illegal/garbage uci", () => {
    expect(bestMoveSan(START, [{ pvUci: ["z9z9"] }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/server -- src/analysis/bestMove.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper**

Create `server/src/analysis/bestMove.ts`:

```ts
import { Chess } from "chess.js";

/** SAN of the engine's top move (first PV, first uci) for `fen`, or null if absent/illegal. */
export function bestMoveSan(fen: string, lines: { pvUci: string[] }[]): string | null {
  const bestUci = lines[0]?.pvUci[0];
  if (!bestUci) return null;
  try {
    const chess = new Chess(fen);
    const mv = chess.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4),
      promotion: bestUci.slice(4, 5) || undefined });
    return mv.san;
  } catch { return null; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/server -- src/analysis/bestMove.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `leaksQuery.bestSanFor` to reuse the helper**

In `server/src/leaks/leaksQuery.ts`, add the import near the top:

```ts
import { bestMoveSan } from "../analysis/bestMove.js";
```

Replace the body of `bestSanFor` (keep its signature) with:

```ts
async function bestSanFor(db: Db, epd: string, fen: string, opts: LeaksOptions): Promise<string | null> {
  const rows = await db.select().from(schema.positionEvals).where(
    and(eq(schema.positionEvals.epd, epd), eq(schema.positionEvals.depth, opts.depth),
      eq(schema.positionEvals.engineVersion, opts.engineVersion)));
  const lines = rows[0] ? (JSON.parse(rows[0].linesJson) as { pvUci: string[] }[]) : [];
  return bestMoveSan(fen, lines);
}
```

If the `Chess` import in `leaksQuery.ts` is now unused, remove it.

- [ ] **Step 6: Run the leaks suite to confirm no behavior change**

Run: `npm run test -w @coc/server -- src/leaks/leaksQuery.test.ts`
Expected: PASS (unchanged output).

- [ ] **Step 7: Commit**

```bash
git add server/src/analysis/bestMove.ts server/src/analysis/bestMove.test.ts server/src/leaks/leaksQuery.ts
git commit -m "refactor(server): extract bestMoveSan helper shared by leaks + review"
```

---

### Task 3: `getGameReview` enrichment query

**Files:**
- Create: `server/src/games/gameReview.ts`
- Test: `server/src/games/gameReview.test.ts` (create)

**Interfaces:**
- Consumes: `bestMoveSan` (Task 2); `scoreToCp`, `toEpd` from `@coc/shared`; Drizzle `schema`.
- Produces: `getGameReview(db: Db, id: string, opts: { depth: number; engineVersion: string }): Promise<GameReview | null>` — game metadata + ordered enriched `moves[]`. Returns `null` if no such game. `evalBeforeWhiteCp`/`evalAfterWhiteCp` are White-POV; `engineLines`/`bookMoves`/`betterMoveSan` describe the position **before** each ply.
- Produces: `whitePovCp(epd: string, row: { scoreCp: number | null; mateIn: number | null } | undefined): number | null` (exported for reuse/testing).

- [ ] **Step 1: Write the failing test**

Create `server/src/games/gameReview.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getGameReview, whitePovCp } from "./gameReview.js";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE games (id text primary key, source text, url text, username text,
    my_color text, result text, time_class text, end_time integer, eco text, opening_name text,
    my_rating integer, opp_rating integer, pgn text);`);
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  await c.execute(`CREATE TABLE position_evals (epd text, depth integer, engine_version text,
    score_cp integer, mate_in integer, lines_json text, primary key (epd, depth, engine_version));`);
  await c.execute(`CREATE TABLE book_stats (epd text, source text, total integer, moves_json text,
    fetched_at integer, primary key (epd, source));`);
  return drizzle(c, { schema });
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
const AFTER_E4_EPD = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3";

describe("whitePovCp", () => {
  it("keeps white-to-move evals and negates black-to-move evals", () => {
    expect(whitePovCp(START_EPD, { scoreCp: 30, mateIn: null })).toBe(30);
    expect(whitePovCp(AFTER_E4_EPD, { scoreCp: 30, mateIn: null })).toBe(-30);
    expect(whitePovCp(AFTER_E4_EPD, undefined)).toBeNull();
  });
});

describe("getGameReview", () => {
  it("returns null for an unknown game", async () => {
    const db = await memDb();
    expect(await getGameReview(db, "nope", { depth: 18, engineVersion: "v" })).toBeNull();
  });

  it("enriches each ply with white-POV evals, engine lines, book, and better move", async () => {
    const db = await memDb();
    await db.insert(schema.games).values({ id: "g1", source: "chesscom", url: null, username: "me",
      myColor: "white", result: "loss", timeClass: "rapid", endTime: 7, eco: "B20",
      openingName: "Sicilian Defense", myRating: 1500, oppRating: 1500, pgn: "" });
    await db.insert(schema.moves).values({ gameId: "g1", ply: 1, fenBefore: START, fenAfter: AFTER_E4,
      epdBefore: START_EPD, epdAfter: AFTER_E4_EPD, san: "e4", uci: "e2e4", isMine: true,
      bookStatus: "in_book", evalBestCp: 30, evalPlayedCp: 25, cpLoss: 5, classification: "book" });
    await db.insert(schema.positionEvals).values([
      { epd: START_EPD, depth: 18, engineVersion: "v", scoreCp: 30, mateIn: null,
        linesJson: JSON.stringify([{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["d2d4"] }]) },
      { epd: AFTER_E4_EPD, depth: 18, engineVersion: "v", scoreCp: 28, mateIn: null,
        linesJson: JSON.stringify([{ rank: 1, scoreCp: 28, mateIn: null, pvUci: ["c7c5"] }]) },
    ]);
    await db.insert(schema.bookStats).values({ epd: START_EPD, source: "masters", total: 200,
      movesJson: JSON.stringify([{ san: "e4", uci: "e2e4", count: 120, white: 60, draws: 40, black: 20 }]),
      fetchedAt: 0 });

    const review = await getGameReview(db, "g1", { depth: 18, engineVersion: "v" });
    expect(review).not.toBeNull();
    expect(review!.openingName).toBe("Sicilian Defense");
    expect(review!.myColor).toBe("white");
    expect(review!.moves).toHaveLength(1);
    const m = review!.moves[0]!;
    expect(m.san).toBe("e4");
    expect(m.evalBeforeWhiteCp).toBe(30);   // white to move at start
    expect(m.evalAfterWhiteCp).toBe(-28);   // black to move after e4 -> negate
    expect(m.betterMoveSan).toBe("d4");     // best PV at the start position
    expect(m.engineLines[0]!.pvUci).toEqual(["d2d4"]);
    expect(m.bookMoves).toEqual([{ san: "e4", count: 120 }]);
    expect(m.bookTotal).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/server -- src/games/gameReview.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the query**

Create `server/src/games/gameReview.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/server -- src/games/gameReview.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/games/gameReview.ts server/src/games/gameReview.test.ts
git commit -m "feat(server): getGameReview enrichment with white-POV evals"
```

---

### Task 4: `getLeakOccurrences` query

**Files:**
- Create: `server/src/leaks/leakOccurrences.ts`
- Test: `server/src/leaks/leakOccurrences.test.ts` (create)

**Interfaces:**
- Produces: `getLeakOccurrences(db: Db, epdBefore: string, san: string): Promise<LeakOccurrence[]>` — the user's moves matching `(epdBefore, san)`, joined to their games, newest first.

- [ ] **Step 1: Write the failing test**

Create `server/src/leaks/leakOccurrences.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getLeakOccurrences } from "./leakOccurrences.js";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE games (id text primary key, source text, url text, username text,
    my_color text, result text, time_class text, end_time integer, eco text, opening_name text,
    my_rating integer, opp_rating integer, pgn text);`);
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  return drizzle(c, { schema });
}

const EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";

describe("getLeakOccurrences", () => {
  it("returns the user's matching moves with game + ply, newest first", async () => {
    const db = await memDb();
    for (const [gid, end] of [["g1", 100], ["g2", 200]] as const) {
      await db.insert(schema.games).values({ id: gid, source: "chesscom", url: null, username: "me",
        myColor: "white", result: "loss", timeClass: "rapid", endTime: end, eco: "B20",
        openingName: "Sicilian Defense", myRating: 1500, oppRating: 1500, pgn: "" });
      await db.insert(schema.moves).values({ gameId: gid, ply: 2, fenBefore: "F", fenAfter: "F2",
        epdBefore: EPD, epdAfter: "E2", san: "d4", uci: "d2d4", isMine: true, bookStatus: "novelty",
        evalBestCp: 30, evalPlayedCp: -90, cpLoss: 120, classification: "mistake" });
    }
    // a non-mine move with the same key must be ignored
    await db.insert(schema.moves).values({ gameId: "g1", ply: 9, fenBefore: "F", fenAfter: "F2",
      epdBefore: EPD, epdAfter: "E2", san: "d4", uci: "d2d4", isMine: false, bookStatus: "novelty",
      evalBestCp: null, evalPlayedCp: null, cpLoss: null, classification: null });

    const occ = await getLeakOccurrences(db, EPD, "d4");
    expect(occ.map((o) => o.gameId)).toEqual(["g2", "g1"]);
    expect(occ[0]).toMatchObject({ gameId: "g2", ply: 2, result: "loss", myColor: "white",
      openingName: "Sicilian Defense" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/server -- src/leaks/leakOccurrences.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the query**

Create `server/src/leaks/leakOccurrences.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import type { LeakOccurrence } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";

/** The user's moves matching a leak's (position-before, san) key, with their game context. */
export async function getLeakOccurrences(db: Db, epdBefore: string, san: string): Promise<LeakOccurrence[]> {
  const rows = await db.select({
    gameId: schema.moves.gameId, ply: schema.moves.ply, result: schema.games.result,
    endTime: schema.games.endTime, openingName: schema.games.openingName, myColor: schema.games.myColor,
  })
    .from(schema.moves)
    .innerJoin(schema.games, eq(schema.moves.gameId, schema.games.id))
    .where(and(eq(schema.moves.isMine, true), eq(schema.moves.epdBefore, epdBefore), eq(schema.moves.san, san)))
    .orderBy(desc(schema.games.endTime));

  return rows.map((r) => ({
    gameId: r.gameId, ply: r.ply, result: r.result as LeakOccurrence["result"],
    endTime: r.endTime, openingName: r.openingName, myColor: r.myColor as LeakOccurrence["myColor"],
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/server -- src/leaks/leakOccurrences.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/leaks/leakOccurrences.ts server/src/leaks/leakOccurrences.test.ts
git commit -m "feat(server): getLeakOccurrences query for leak->game deep-link"
```

---

### Task 5: Wire routes (`/games`, `/games/:id`, `/leaks/occurrences`)

**Files:**
- Modify: `server/src/routes/app.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/routes/app.test.ts` (add cases)

**Interfaces:**
- Consumes: `GameSummary`, `GameReview`, `LeakOccurrence` (Task 1); `getGameReview` (Task 3); `getLeakOccurrences` (Task 4).
- Produces (AppDeps): `getGames?: () => Promise<GameSummary[]>`, `getGame?: (id) => Promise<GameReview | null>`, `getOccurrences?: (epd: string, san: string) => Promise<LeakOccurrence[]>`. Routes: `GET /games`, `GET /games/:id` (404 when null), `GET /leaks/occurrences?epd=&san=`.

- [ ] **Step 1: Write the failing test**

Add to `server/src/routes/app.test.ts`:

```ts
import { GameSummary, GameReview, LeakOccurrence } from "@coc/shared";

describe("games + occurrences routes", () => {
  const summary = GameSummary.parse({ id: "g1", source: "chesscom", openingName: "Sicilian Defense",
    eco: "B20", myColor: "white", result: "loss", timeClass: "rapid", endTime: 1, myRating: 1500, oppRating: 1490 });
  const review = GameReview.parse({ ...summary, moves: [] });
  const occ = LeakOccurrence.parse({ gameId: "g1", ply: 2, result: "loss", endTime: 1,
    openingName: "Sicilian Defense", myColor: "white" });

  it("GET /games returns summaries", async () => {
    const app = createApp({ runStore: new RunStore(), startSync: async () => {}, getGames: async () => [summary] });
    expect(await (await app.request("/games")).json()).toEqual([summary]);
  });

  it("GET /games/:id returns a review or 404", async () => {
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getGame: async (id) => (id === "g1" ? review : null) });
    expect(await (await app.request("/games/g1")).json()).toEqual(review);
    expect((await app.request("/games/missing")).status).toBe(404);
  });

  it("GET /leaks/occurrences passes epd+san to the query", async () => {
    let seen: [string, string] | null = null;
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getOccurrences: async (epd, san) => { seen = [epd, san]; return [occ]; } });
    const res = await app.request("/leaks/occurrences?epd=" + encodeURIComponent("E w - -") + "&san=d4");
    expect(await res.json()).toEqual([occ]);
    expect(seen).toEqual(["E w - -", "d4"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/server -- src/routes/app.test.ts`
Expected: FAIL — `getOccurrences` not in `AppDeps`; `/games/:id` returns the old `GameDetail` shape; `/leaks/occurrences` 404s.

- [ ] **Step 3: Update `app.ts`**

In `server/src/routes/app.ts`: replace the local `GameSummary`/`GameDetail` interfaces and update imports + deps + routes.

Replace the import line:

```ts
import { SyncRequest, type Leak } from "@coc/shared";
```

with:

```ts
import { z } from "zod";
import { SyncRequest, type Leak, type GameSummary, type GameReview, type LeakOccurrence } from "@coc/shared";
```

Delete the two local interface lines (`export interface GameSummary {...}` and `export interface GameDetail extends GameSummary {...}`).

In `AppDeps`, replace the `getGames`/`getGame` lines and add `getOccurrences`:

```ts
  getLeaks?: () => Promise<Leak[]>;
  getGames?: () => Promise<GameSummary[]>;
  getGame?: (id: string) => Promise<GameReview | null>;
  getOccurrences?: (epd: string, san: string) => Promise<LeakOccurrence[]>;
```

Add the occurrences route to the chain (place it **before** `.get("/leaks", ...)` is fine; paths don't collide, but keep it grouped with leaks). Insert after the `.get("/leaks", ...)` line:

```ts
    .get("/leaks/occurrences", zValidator("query", z.object({ epd: z.string(), san: z.string() })), async (c) => {
      const { epd, san } = c.req.valid("query");
      return c.json((await deps.getOccurrences?.(epd, san)) ?? []);
    })
```

The existing `/games`, `/games/:id` routes already call `deps.getGames`/`deps.getGame`; no change needed there beyond the new return types.

- [ ] **Step 4: Update `index.ts` wiring**

In `server/src/index.ts`:

Add imports:

```ts
import { getGameReview } from "./games/gameReview.js";
import { getLeakOccurrences } from "./leaks/leakOccurrences.js";
```

Replace the `getGames` and `getGame` deps and add `getOccurrences`:

```ts
  getGames: async () => (await db.select().from(schema.games)).map((g) => ({
    id: g.id, source: g.source as "chesscom" | "lichess", openingName: g.openingName, eco: g.eco,
    myColor: g.myColor as "white" | "black", result: g.result as "win" | "loss" | "draw",
    timeClass: g.timeClass as "bullet" | "blitz" | "rapid" | "classical" | "daily",
    endTime: g.endTime, myRating: g.myRating, oppRating: g.oppRating })),
  getGame: (id) => getGameReview(db, id, { depth: DEPTH, engineVersion: engineVersion() }),
  getOccurrences: (epd, san) => getLeakOccurrences(db, epd, san),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @coc/server -- src/routes/app.test.ts`
Expected: PASS. Then run the full server suite: `npm run test -w @coc/server` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/app.ts server/src/index.ts server/src/routes/app.test.ts
git commit -m "feat(server): /games review payload + /leaks/occurrences routes"
```

---

### Task 6: `ClassificationChip` component

**Files:**
- Create: `web/src/components/ClassificationChip.tsx`
- Test: `web/src/components/ClassificationChip.test.tsx` (create)

**Interfaces:**
- Produces: `ClassificationChip({ classification, bookStatus }: { classification: Classification | null; bookStatus: BookStatus | null })` — a small colored span. Renders nothing when `classification` is null.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ClassificationChip.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClassificationChip } from "./ClassificationChip.js";

describe("ClassificationChip", () => {
  it("labels a blunder", () => {
    render(<ClassificationChip classification="blunder" bookStatus="novelty" />);
    expect(screen.getByText(/blunder/i)).toBeInTheDocument();
  });
  it("renders nothing without a classification", () => {
    const { container } = render(<ClassificationChip classification={null} bookStatus={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/components/ClassificationChip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `web/src/components/ClassificationChip.tsx`:

```tsx
import type { Classification, BookStatus } from "@coc/shared";

const COLORS: Record<Classification, string> = {
  best: "#27ae60", book: "#2980b9", inaccuracy: "#e1a100", mistake: "#e67e22", blunder: "#c0392b",
};

export function ClassificationChip({ classification, bookStatus }:
  { classification: Classification | null; bookStatus: BookStatus | null }) {
  if (!classification) return null;
  const title = bookStatus ? `book: ${bookStatus}` : undefined;
  return (
    <span title={title} style={{ background: COLORS[classification], color: "#fff", borderRadius: 4,
      padding: "0 6px", fontSize: 11, marginLeft: 6 }}>
      {classification}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/web -- src/components/ClassificationChip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ClassificationChip.tsx web/src/components/ClassificationChip.test.tsx
git commit -m "feat(web): ClassificationChip component"
```

---

### Task 7: `MoveList` component

**Files:**
- Create: `web/src/components/MoveList.tsx`
- Test: `web/src/components/MoveList.test.tsx` (create)

**Interfaces:**
- Consumes: `ReviewMove` (from `@coc/shared`), `ClassificationChip` (Task 6).
- Produces: `MoveList({ moves, selected, onSelect }: { moves: ReviewMove[]; selected: number; onSelect: (index: number) => void })`. `selected` is a 1..N "plies played" index; the highlighted move is `moves[selected-1]`. Clicking move `i` (0-based) calls `onSelect(i + 1)`. Each move's button has `data-testid={"move-" + i}`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/MoveList.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReviewMove } from "@coc/shared";
import { MoveList } from "./MoveList.js";

const mv = (over: Partial<ReviewMove>): ReviewMove => ({
  ply: 1, san: "e4", uci: "e2e4", isMine: true, fenBefore: "F0", fenAfter: "F1",
  bookStatus: "book" as never, classification: "book", cpLoss: 0,
  evalBeforeWhiteCp: 20, evalAfterWhiteCp: 25, engineLines: [], betterMoveSan: "e4",
  bookMoves: [], bookTotal: 0, ...over,
});

const moves: ReviewMove[] = [
  mv({ ply: 1, san: "e4", isMine: true, classification: "book" }),
  mv({ ply: 2, san: "c5", isMine: false, classification: null }),
  mv({ ply: 3, san: "d4", isMine: true, classification: "mistake" }),
];

describe("MoveList", () => {
  it("shows chips on the user's moves and calls onSelect with the 1-based index", () => {
    const onSelect = vi.fn();
    render(<MoveList moves={moves} selected={1} onSelect={onSelect} />);
    expect(screen.getByText("e4")).toBeInTheDocument();
    expect(screen.getByText("mistake")).toBeInTheDocument(); // chip on the d4 blunder/mistake
    fireEvent.click(screen.getByTestId("move-2"));
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/components/MoveList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `web/src/components/MoveList.tsx`:

```tsx
import type { ReviewMove } from "@coc/shared";
import { ClassificationChip } from "./ClassificationChip.js";

/** `selected` is the number of plies played (1..N); the highlighted move is moves[selected-1]. */
export function MoveList({ moves, selected, onSelect }:
  { moves: ReviewMove[]; selected: number; onSelect: (index: number) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 280 }}>
      {moves.map((m, i) => {
        const isWhite = i % 2 === 0;
        const isCurrent = selected === i + 1;
        return (
          <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
            {isWhite && <b style={{ marginRight: 4, color: "#888" }}>{i / 2 + 1}.</b>}
            <button data-testid={"move-" + i} onClick={() => onSelect(i + 1)}
              style={{ background: isCurrent ? "#dde3ff" : "transparent", border: "none",
                cursor: "pointer", padding: "2px 4px", fontWeight: isCurrent ? 700 : 400 }}>
              {m.san}
              <ClassificationChip classification={m.classification} bookStatus={m.bookStatus} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/web -- src/components/MoveList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/MoveList.tsx web/src/components/MoveList.test.tsx
git commit -m "feat(web): MoveList with classification chips and selection"
```

---

### Task 8: `EvalGraph` component (SVG sparkline)

**Files:**
- Create: `web/src/components/EvalGraph.tsx`
- Test: `web/src/components/EvalGraph.test.tsx` (create)

**Interfaces:**
- Produces: `EvalGraph({ points, selected, onSelect }: { points: (number | null)[]; selected: number; onSelect: (index: number) => void })`. `points[i]` is the White-POV cp at index `i` (index 0 = start position, index k = after ply k); `null` points are skipped in the line but still clickable. Each clickable dot has `data-testid={"eval-pt-" + i}` and calls `onSelect(i)`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/EvalGraph.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EvalGraph } from "./EvalGraph.js";

describe("EvalGraph", () => {
  it("renders a dot per point and reports clicks by index", () => {
    const onSelect = vi.fn();
    render(<EvalGraph points={[0, 30, null, -120]} selected={1} onSelect={onSelect} />);
    expect(screen.getByTestId("eval-pt-0")).toBeInTheDocument();
    expect(screen.getByTestId("eval-pt-3")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("eval-pt-3"));
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/components/EvalGraph.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `web/src/components/EvalGraph.tsx`:

```tsx
const W = 280, H = 80, PAD = 4, CLAMP = 600; // cp clamp for the y-axis

function y(cp: number): number {
  const c = Math.max(-CLAMP, Math.min(CLAMP, cp));
  return PAD + (1 - (c + CLAMP) / (2 * CLAMP)) * (H - 2 * PAD);
}

export function EvalGraph({ points, selected, onSelect }:
  { points: (number | null)[]; selected: number; onSelect: (index: number) => void }) {
  const n = points.length;
  const x = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - 2 * PAD));
  const line = points
    .map((cp, i) => (cp === null ? null : `${x(i)},${y(cp)}`))
    .filter((p): p is string => p !== null)
    .join(" ");

  return (
    <svg width={W} height={H} role="img" aria-label="opening eval graph" style={{ background: "#f4f5fb" }}>
      <line x1={PAD} y1={y(0)} x2={W - PAD} y2={y(0)} stroke="#ccc" />
      <polyline points={line} fill="none" stroke="#5566cc" strokeWidth={2} />
      {points.map((cp, i) => (
        <circle key={i} data-testid={"eval-pt-" + i} cx={x(i)} cy={cp === null ? y(0) : y(cp)}
          r={i === selected ? 5 : 3} fill={i === selected ? "#c0392b" : "#5566cc"}
          style={{ cursor: "pointer" }} onClick={() => onSelect(i)} />
      ))}
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/web -- src/components/EvalGraph.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/EvalGraph.tsx web/src/components/EvalGraph.test.tsx
git commit -m "feat(web): EvalGraph SVG sparkline"
```

---

### Task 9: `PositionPanel` component

**Files:**
- Create: `web/src/components/PositionPanel.tsx`
- Test: `web/src/components/PositionPanel.test.tsx` (create)

**Interfaces:**
- Consumes: `ReviewMove`; `chess.js` (`Chess`) to turn each engine line's first uci into SAN from `fenBefore`.
- Produces: `PositionPanel({ move }: { move: ReviewMove })` — shows the played move + chip, the engine's top lines (SAN + cp), and book moves. Renders an empty-state note when there are no engine lines.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/PositionPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReviewMove } from "@coc/shared";
import { PositionPanel } from "./PositionPanel.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const move: ReviewMove = {
  ply: 1, san: "e4", uci: "e2e4", isMine: true, fenBefore: START, fenAfter: "F1",
  bookStatus: "novelty", classification: "mistake", cpLoss: 120,
  evalBeforeWhiteCp: 30, evalAfterWhiteCp: -90,
  engineLines: [
    { rank: 1, scoreCp: 30, mateIn: null, pvUci: ["d2d4"] },
    { rank: 2, scoreCp: 10, mateIn: null, pvUci: ["g1f3"] },
  ],
  betterMoveSan: "d4", bookMoves: [{ san: "e4", count: 120 }], bookTotal: 200,
};

describe("PositionPanel", () => {
  it("shows the engine's SAN lines, the better move, and book counts", () => {
    render(<PositionPanel move={move} />);
    // "Nf3" comes only from firstSan(g1f3) in the engine list — verifies SAN derivation uniquely.
    expect(screen.getByText("Nf3")).toBeInTheDocument();
    expect(screen.getByText(/Engine prefers/)).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument(); // book move count, unique on the page
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/components/PositionPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `web/src/components/PositionPanel.tsx`:

```tsx
import { Chess } from "chess.js";
import type { ReviewMove, EngineLine } from "@coc/shared";
import { ClassificationChip } from "./ClassificationChip.js";

function firstSan(fen: string, line: EngineLine): string {
  const uci = line.pvUci[0];
  if (!uci) return "";
  try {
    const chess = new Chess(fen);
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined }).san;
  } catch { return ""; }
}

function cpLabel(line: EngineLine): string {
  if (line.mateIn !== null) return `#${line.mateIn}`;
  const cp = (line.scoreCp ?? 0) / 100;
  return cp >= 0 ? `+${cp.toFixed(2)}` : cp.toFixed(2);
}

export function PositionPanel({ move }: { move: ReviewMove }) {
  return (
    <div style={{ minWidth: 200 }}>
      <p>You played <b>{move.san}</b>
        <ClassificationChip classification={move.classification} bookStatus={move.bookStatus} />
      </p>
      {move.betterMoveSan && move.classification !== "best" && move.classification !== "book" &&
        <p style={{ color: "#27ae60" }}>Engine prefers <b>{move.betterMoveSan}</b></p>}
      <h4 style={{ margin: "8px 0 4px" }}>Engine</h4>
      {move.engineLines.length === 0 ? <p style={{ color: "#888" }}>No engine eval cached.</p> : (
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {move.engineLines.map((l) => (
            <li key={l.rank}>{firstSan(move.fenBefore, l)} <span style={{ color: "#888" }}>{cpLabel(l)}</span></li>
          ))}
        </ul>
      )}
      {move.bookMoves.length > 0 && (
        <>
          <h4 style={{ margin: "8px 0 4px" }}>Book ({move.bookTotal})</h4>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {move.bookMoves.slice(0, 5).map((b) => <li key={b.san}>{b.san} <span style={{ color: "#888" }}>{b.count}</span></li>)}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/web -- src/components/PositionPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PositionPanel.tsx web/src/components/PositionPanel.test.tsx
git commit -m "feat(web): PositionPanel showing engine lines + book"
```

---

### Task 10: `ReviewWorkspace` component

**Files:**
- Create: `web/src/components/ReviewWorkspace.tsx`
- Test: `web/src/components/ReviewWorkspace.test.tsx` (create)

**Interfaces:**
- Consumes: `GameReview`; `Chessboard`, `EvalBar`, `MoveList`, `EvalGraph`, `PositionPanel`.
- Produces: `ReviewWorkspace({ review, initialPly }: { review: GameReview; initialPly?: number })`. Owns `selected` ∈ [0, moves.length] (clamped from `initialPly`, default 0). Board shows the position after `selected` plies (start fen when 0); eval bar shows the White-POV eval at `selected`; `data-testid="ply-indicator"` shows `selected/N`. ←/→ step, Home/End jump. The graph's `points` array is `[evalBeforeWhiteCp(move0), evalAfterWhiteCp(move0..N-1)]` (length N+1).

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ReviewWorkspace.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { GameReview, ReviewMove } from "@coc/shared";

vi.mock("./Chessboard.js", () => ({ Chessboard: ({ fen }: { fen: string }) => <div data-testid="board" data-fen={fen} /> }));

import { ReviewWorkspace } from "./ReviewWorkspace.js";

const mv = (over: Partial<ReviewMove>): ReviewMove => ({
  ply: 1, san: "e4", uci: "e2e4", isMine: true, fenBefore: "START", fenAfter: "AFTER1",
  bookStatus: "book" as never, classification: "book", cpLoss: 0,
  evalBeforeWhiteCp: 20, evalAfterWhiteCp: 25, engineLines: [], betterMoveSan: "e4",
  bookMoves: [], bookTotal: 0, ...over,
});
const review: GameReview = {
  id: "g1", source: "chesscom", openingName: "Sicilian", eco: "B20", myColor: "white",
  result: "loss", timeClass: "rapid", endTime: 1, myRating: 1500, oppRating: 1500,
  moves: [mv({ ply: 1, fenBefore: "START", fenAfter: "AFTER1" }),
          mv({ ply: 2, san: "c5", isMine: false, fenBefore: "AFTER1", fenAfter: "AFTER2" })],
};

describe("ReviewWorkspace", () => {
  it("starts at the position, then steps forward with ArrowRight", () => {
    render(<ReviewWorkspace review={review} />);
    expect(screen.getByTestId("ply-indicator")).toHaveTextContent("0/2");
    expect(screen.getByTestId("board")).toHaveAttribute("data-fen", "START");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("ply-indicator")).toHaveTextContent("1/2");
    expect(screen.getByTestId("board")).toHaveAttribute("data-fen", "AFTER1");
  });
  it("seeds the selected ply from initialPly", () => {
    render(<ReviewWorkspace review={review} initialPly={2} />);
    expect(screen.getByTestId("ply-indicator")).toHaveTextContent("2/2");
    expect(screen.getByTestId("board")).toHaveAttribute("data-fen", "AFTER2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/components/ReviewWorkspace.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `web/src/components/ReviewWorkspace.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { GameReview } from "@coc/shared";
import { Chessboard, type BoardArrow } from "./Chessboard.js";
import { EvalBar } from "./EvalBar.js";
import { MoveList } from "./MoveList.js";
import { EvalGraph } from "./EvalGraph.js";
import { PositionPanel } from "./PositionPanel.js";

const ARROW_BRUSH: Record<string, BoardArrow["brush"]> = {
  best: "green", book: "blue", inaccuracy: "green", mistake: "red", blunder: "red",
};

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

export function ReviewWorkspace({ review, initialPly }: { review: GameReview; initialPly?: number }) {
  const n = review.moves.length;
  const [selected, setSelected] = useState(clamp(initialPly ?? 0, 0, n));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setSelected((s) => clamp(s + 1, 0, n));
      else if (e.key === "ArrowLeft") setSelected((s) => clamp(s - 1, 0, n));
      else if (e.key === "Home") setSelected(0);
      else if (e.key === "End") setSelected(n);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n]);

  const current = selected > 0 ? review.moves[selected - 1]! : null;
  const fen = current ? current.fenAfter : (review.moves[0]?.fenBefore ?? "start");
  const evalCp = current ? current.evalAfterWhiteCp : (review.moves[0]?.evalBeforeWhiteCp ?? null);
  const arrows: BoardArrow[] = current
    ? [{ orig: current.uci.slice(0, 2), dest: current.uci.slice(2, 4),
        brush: (current.classification && ARROW_BRUSH[current.classification]) ?? "green" }]
    : [];
  const points = [review.moves[0]?.evalBeforeWhiteCp ?? null, ...review.moves.map((m) => m.evalAfterWhiteCp)];

  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <EvalBar cp={evalCp ?? 0} />
        <div>
          <Chessboard fen={fen} arrows={arrows} />
          <div data-testid="ply-indicator" style={{ marginTop: 4, color: "#666" }}>{selected}/{n}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <EvalGraph points={points} selected={selected} onSelect={setSelected} />
        <MoveList moves={review.moves} selected={selected} onSelect={setSelected} />
      </div>
      {current && <PositionPanel move={current} />}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/web -- src/components/ReviewWorkspace.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ReviewWorkspace.tsx web/src/components/ReviewWorkspace.test.tsx
git commit -m "feat(web): ReviewWorkspace composing board, graph, move list, panel"
```

---

### Task 11: `GamesTable` component

**Files:**
- Create: `web/src/components/GamesTable.tsx`
- Test: `web/src/components/GamesTable.test.tsx` (create)

**Interfaces:**
- Consumes: `GameSummary`.
- Produces: `GamesTable({ games, onOpen }: { games: GameSummary[]; onOpen: (id: string) => void })` — a filterable table. Filters: result (`all`/win/loss/draw via a select with `aria-label="result filter"`), color (select `aria-label="color filter"`), and opening text search (`placeholder="opening"`). Row click calls `onOpen(id)`. Rows newest-first by `endTime`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/GamesTable.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { GameSummary } from "@coc/shared";
import { GamesTable } from "./GamesTable.js";

const g = (over: Partial<GameSummary>): GameSummary => ({
  id: "g1", source: "chesscom", openingName: "Sicilian Defense", eco: "B20", myColor: "white",
  result: "loss", timeClass: "rapid", endTime: 1, myRating: 1500, oppRating: 1500, ...over,
});
const games: GameSummary[] = [
  g({ id: "g1", openingName: "Sicilian Defense", result: "loss", endTime: 10 }),
  g({ id: "g2", openingName: "Italian Game", result: "win", endTime: 20, myColor: "black" }),
];

describe("GamesTable", () => {
  it("filters by result and opens a row", () => {
    const onOpen = vi.fn();
    render(<GamesTable games={games} onOpen={onOpen} />);
    expect(screen.getByText("Italian Game")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("result filter"), { target: { value: "win" } });
    expect(screen.queryByText("Sicilian Defense")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Italian Game"));
    expect(onOpen).toHaveBeenCalledWith("g2");
  });

  it("filters by opening search text", () => {
    render(<GamesTable games={games} onOpen={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("opening"), { target: { value: "sicil" } });
    expect(screen.getByText("Sicilian Defense")).toBeInTheDocument();
    expect(screen.queryByText("Italian Game")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/components/GamesTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `web/src/components/GamesTable.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { GameSummary, GameResult, Color } from "@coc/shared";

export function GamesTable({ games, onOpen }: { games: GameSummary[]; onOpen: (id: string) => void }) {
  const [result, setResult] = useState<GameResult | "all">("all");
  const [color, setColor] = useState<Color | "all">("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => games
    .filter((g) => result === "all" || g.result === result)
    .filter((g) => color === "all" || g.myColor === color)
    .filter((g) => !q || (g.openingName ?? "").toLowerCase().includes(q.toLowerCase()))
    .slice()
    .sort((a, b) => b.endTime - a.endTime), [games, result, color, q]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <select aria-label="result filter" value={result} onChange={(e) => setResult(e.target.value as GameResult | "all")}>
          <option value="all">all results</option><option value="win">win</option>
          <option value="loss">loss</option><option value="draw">draw</option>
        </select>
        <select aria-label="color filter" value={color} onChange={(e) => setColor(e.target.value as Color | "all")}>
          <option value="all">both colors</option><option value="white">white</option><option value="black">black</option>
        </select>
        <input placeholder="opening" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
          <th>Opening</th><th>Color</th><th>Result</th><th>Time</th></tr></thead>
        <tbody>
          {rows.map((gm) => (
            <tr key={gm.id} onClick={() => onOpen(gm.id)} style={{ cursor: "pointer", borderBottom: "1px solid #eee" }}>
              <td>{gm.openingName ?? "Unknown opening"}</td><td>{gm.myColor}</td>
              <td>{gm.result}</td><td>{gm.timeClass}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/web -- src/components/GamesTable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/GamesTable.tsx web/src/components/GamesTable.test.tsx
git commit -m "feat(web): GamesTable with result/color/opening filters"
```

---

### Task 12: Routes, nav, and page wrappers (`/games`, `/games/$id`)

**Files:**
- Create: `web/src/routes/games.tsx`
- Create: `web/src/routes/review.tsx`
- Modify: `web/src/router.tsx`
- Modify: `web/src/components/AppShell.tsx`
- Test: `web/src/routes/games.test.tsx` (create)

**Interfaces:**
- Consumes: `GamesTable` (Task 11), `ReviewWorkspace` (Task 10), `api` client, `GameSummary`/`GameReview`.
- Produces: `GamesPage` (lists games, navigates to `/games/$id`), `ReviewPage` (loads one game, reads `?ply`, renders `ReviewWorkspace`); both registered in the router; a "Games" nav link.

- [ ] **Step 1: Write the failing test (GamesPage)**

Create `web/src/routes/games.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GameSummary } from "@coc/shared";

const games: GameSummary[] = [{ id: "g1", source: "chesscom", openingName: "Sicilian Defense", eco: "B20",
  myColor: "white", result: "loss", timeClass: "rapid", endTime: 1, myRating: 1500, oppRating: 1500 }];

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../api/client.js", () => ({
  api: { games: { $get: vi.fn(async () => ({ json: async () => games })) } },
}));

async function renderPage() {
  const { GamesPage } = await import("./games.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><GamesPage /></QueryClientProvider>);
}

describe("GamesPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("lists games from the api", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Sicilian Defense")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/routes/games.test.tsx`
Expected: FAIL — `./games.js` not found.

- [ ] **Step 3: Implement `GamesPage`**

Create `web/src/routes/games.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { GameSummary } from "@coc/shared";
import { api } from "../api/client.js";
import { GamesTable } from "../components/GamesTable.js";

export function GamesPage() {
  const navigate = useNavigate();
  const { data: games = [], isLoading } = useQuery({
    queryKey: ["games"],
    queryFn: async () => (await (await api.games.$get()).json()) as GameSummary[],
  });
  if (isLoading) return <p>Loading games&hellip;</p>;
  if (!games.length) return <p>No games yet &mdash; run a sync from the Dashboard.</p>;
  return (
    <div>
      <h1>Games</h1>
      <GamesTable games={games} onOpen={(id) => navigate({ to: "/games/$id", params: { id } })} />
    </div>
  );
}
```

- [ ] **Step 4: Implement `ReviewPage`**

Create `web/src/routes/review.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import type { GameReview } from "@coc/shared";
import { api } from "../api/client.js";
import { ReviewWorkspace } from "../components/ReviewWorkspace.js";

export function ReviewPage() {
  const { id } = useParams({ from: "/games/$id" });
  const { ply } = useSearch({ from: "/games/$id" });
  const { data, isLoading } = useQuery({
    queryKey: ["game", id],
    queryFn: async () => {
      const res = await api.games[":id"].$get({ param: { id } });
      if (res.status === 404) return null;
      return (await res.json()) as GameReview;
    },
  });
  if (isLoading) return <p>Loading review&hellip;</p>;
  if (!data) return <p>Game not found.</p>;
  return (
    <div>
      <h1>{data.openingName ?? "Unknown opening"} <span style={{ color: "#888", fontSize: 14 }}>({data.result})</span></h1>
      {data.moves.length === 0
        ? <p>This game has no analyzed opening moves.</p>
        : <ReviewWorkspace review={data} initialPly={ply} />}
    </div>
  );
}
```

- [ ] **Step 5: Register routes + search validation in `router.tsx`**

Replace `web/src/router.tsx` with:

```tsx
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell.js";
import { DashboardPage } from "./routes/dashboard.js";
import { LeaksPage } from "./routes/leaks.js";
import { GamesPage } from "./routes/games.js";
import { ReviewPage } from "./routes/review.js";

const rootRoute = createRootRoute({ component: () => (<AppShell><Outlet /></AppShell>) });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: DashboardPage });
const leaksRoute = createRoute({ getParentRoute: () => rootRoute, path: "/leaks", component: LeaksPage });
const gamesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/games", component: GamesPage });
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute, path: "/games/$id", component: ReviewPage,
  validateSearch: (s: Record<string, unknown>): { ply?: number } => {
    const ply = Number(s.ply);
    return Number.isFinite(ply) ? { ply } : {};
  },
});

const routeTree = rootRoute.addChildren([dashboardRoute, leaksRoute, gamesRoute, reviewRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
```

- [ ] **Step 6: Add the Games nav link in `AppShell.tsx`**

In `web/src/components/AppShell.tsx`, update the `NAV` array:

```tsx
const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/leaks", label: "Leaks" },
  { to: "/games", label: "Games" },
];
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run test -w @coc/web -- src/routes/games.test.tsx`
Expected: PASS.
Run: `npm run build -w @coc/web`
Expected: builds with no TypeScript errors (validates router param/search typing and the hono `api.games[":id"]` call).

- [ ] **Step 8: Commit**

```bash
git add web/src/routes/games.tsx web/src/routes/review.tsx web/src/router.tsx \
  web/src/components/AppShell.tsx web/src/routes/games.test.tsx
git commit -m "feat(web): Games list + Review routes and nav"
```

---

### Task 13: Leak → Review deep-link

**Files:**
- Modify: `web/src/components/ExplorerLines.tsx` (extend `LeakDetail` to fetch + list occurrences)
- Test: `web/src/components/ExplorerLines.test.tsx` (create)

**Interfaces:**
- Consumes: `Leak`, `LeakOccurrence`; `api.leaks.occurrences.$get`; TanStack `Link`.
- Produces: `LeakDetail` additionally fetches `/leaks/occurrences?epd=<fenBefore-as-epd>&san=<yourMoveSan>` and renders one `Link` per occurrence to `/games/$id` with `search={{ ply }}`. Uses `toEpd(leak.fenBefore)` from `@coc/shared` for the query key.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ExplorerLines.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Leak, LeakOccurrence } from "@coc/shared";

vi.mock("./Chessboard.js", () => ({ Chessboard: () => null }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params, search }: any) =>
    <a data-testid="occ-link" data-id={params.id} data-ply={search.ply}>{children}</a>,
}));
const occ: LeakOccurrence[] = [{ gameId: "g7", ply: 4, result: "loss", endTime: 1,
  openingName: "Sicilian Defense", myColor: "white" }];
vi.mock("../api/client.js", () => ({
  api: { leaks: { occurrences: { $get: vi.fn(async () => ({ json: async () => occ })) } } },
}));

const leak: Leak = { openingName: "Sicilian Defense", eco: "B20",
  fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", lineSan: "",
  yourMoveSan: "d4", betterMoveSan: "Nf3", occurrences: 1, avgCpLoss: 120, scorePct: 0, bookStatus: "novelty" };

async function renderDetail() {
  const { LeakDetail } = await import("./ExplorerLines.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><LeakDetail leak={leak} /></QueryClientProvider>);
}

describe("LeakDetail occurrences", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders a deep-link to the game at the offending ply", async () => {
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId("occ-link")).toBeInTheDocument());
    const link = screen.getByTestId("occ-link");
    expect(link).toHaveAttribute("data-id", "g7");
    expect(link).toHaveAttribute("data-ply", "4");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/components/ExplorerLines.test.tsx`
Expected: FAIL — `LeakDetail` does not fetch occurrences / no link rendered.

- [ ] **Step 3: Extend `LeakDetail`**

Replace `web/src/components/ExplorerLines.tsx` with:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toEpd, type Leak, type LeakOccurrence } from "@coc/shared";
import { api } from "../api/client.js";
import { Chessboard } from "./Chessboard.js";

export function LeakDetail({ leak }: { leak: Leak }) {
  const epd = toEpd(leak.fenBefore);
  const { data: occ = [] } = useQuery({
    queryKey: ["occurrences", epd, leak.yourMoveSan],
    queryFn: async () =>
      (await (await api.leaks.occurrences.$get({ query: { epd, san: leak.yourMoveSan } })).json()) as LeakOccurrence[],
  });

  return (
    <div data-testid="leak-detail" style={{ display: "flex", gap: 16, padding: 12, background: "#f5f6ff" }}>
      <Chessboard fen={leak.fenBefore} size={200} />
      <div>
        <p>You played <b style={{ color: "#c0392b" }}>{leak.yourMoveSan}</b> ({leak.occurrences}&times;).</p>
        {leak.betterMoveSan && <p>Engine prefers <b style={{ color: "#27ae60" }}>{leak.betterMoveSan}</b>.</p>}
        <p>Average loss: {(leak.avgCpLoss / 100).toFixed(2)} &middot; Score {Math.round(leak.scorePct)}% &middot; {leak.bookStatus}</p>
        {occ.length > 0 && (
          <>
            <h4 style={{ margin: "8px 0 4px" }}>Games</h4>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {occ.map((o) => (
                <li key={o.gameId + ":" + o.ply}>
                  <Link to="/games/$id" params={{ id: o.gameId }} search={{ ply: o.ply }}>
                    {o.openingName ?? "game"} &mdash; {o.result} ({o.myColor})
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/web -- src/components/ExplorerLines.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update the existing leaks-page api mock**

`leaks.test.tsx` expands a leak row, which now renders the new `LeakDetail` that calls `api.leaks.occurrences.$get`. Its api mock only defines `leaks.$get`, so add `occurrences` to it. In `web/src/routes/leaks.test.tsx`, replace the api mock:

```tsx
vi.mock("../api/client.js", () => ({
  api: { leaks: { $get: vi.fn(async () => ({ json: async () => leaks })) } },
}));
```

with:

```tsx
vi.mock("../api/client.js", () => ({
  api: {
    leaks: {
      $get: vi.fn(async () => ({ json: async () => leaks })),
      occurrences: { $get: vi.fn(async () => ({ json: async () => [] })) },
    },
  },
}));
```

Also mock the router `Link` so `LeakDetail` renders under the router-free test — add to the top of `leaks.test.tsx`:

```tsx
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
```

(Add `import type React from "react";` if the file does not already import React.)

- [ ] **Step 6: Run the full web suite + build**

Run: `npm run test -w @coc/web`
Expected: PASS (including `leaks.test.tsx` with the extended mock).
Run: `npm run build -w @coc/web`
Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ExplorerLines.tsx web/src/components/ExplorerLines.test.tsx web/src/routes/leaks.test.tsx
git commit -m "feat(web): leak detail lists games and deep-links into Review"
```

---

### Task 14: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run every workspace suite**

Run: `npm test` (shared + server) and `npm run test -w @coc/web` (web).
Expected: PASS across shared, server, and web.

- [ ] **Step 2: Typecheck/build the web app**

Run: `npm run build -w @coc/web`
Expected: clean build (no TS errors).

- [ ] **Step 3: Manual smoke (optional, needs the Stockfish binary + a prior sync)**

Start backend + frontend (`npm run dev:server`, `npm run dev:web`), open the **Games** tab, open a game → step with ←/→, click an eval-graph point, then from **Leaks** expand a row and follow a game link — confirm Review opens at the offending ply.

- [ ] **Step 4: Commit (if any incidental fixes were needed)**

```bash
git add -A
git commit -m "test: phase-2 per-game review full-suite green"
```

---

## Notes for the implementer

- **Eval perspective is the subtle part.** `position_evals.score_cp` is side-to-move-relative; `whitePovCp` negates when the EPD's active color is `b`. The graph/bar/`evalAfter/BeforeWhiteCp` all flow from this — never use `moves.eval_played_cp` for display (it is mover-relative and only set for the user's moves).
- **Review is cached-reads only.** If a position has no cached eval (analysis gap), the enrichment yields `null` evals / empty `engineLines`; the UI degrades (neutral bar, "No engine eval cached.") rather than throwing.
- **Pure components, thin pages.** `ReviewWorkspace`/`GamesTable` take props and are unit-tested without a router; `GamesPage`/`ReviewPage` only wire query + navigation/params. Keep that split so tests stay router-free.
- **`?ply` is clamped** in `ReviewWorkspace` (`clamp(initialPly ?? 0, 0, n)`); a bad/oversized value falls back to a valid index rather than breaking the board.

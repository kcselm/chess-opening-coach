# Phase 3 — Study + Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two browse views over a shared `ExplorerWorkspace` — a **Tree** (navigate the opening positions from your own games, color-scoped, cached) and a **Study** view (pick an opening, browse its lines over the live Lichess book + cached Stockfish eval, with an on-demand Analyze button and free board play) — plus "Study this position" deep-links.

**Architecture:** The backend adds four lazy, per-position read endpoints (`/openings`, `/explore`, `/position`, `/tree`) backed by small pure services that reuse the existing book cache (`getBook`), eval cache (`position_evals`), and engine manager. The frontend renders one pure `ExplorerWorkspace` (board + eval bar + move table + breadcrumb + slots) wrapped by thin `StudyPage`/`TreePage` route components, mirroring the Phase-2 `ReviewWorkspace` pattern. Study drives its line through a `chess.js` game; on-demand engine analysis is rejected with 409 while a sync runs.

**Tech Stack:** TypeScript, Hono + Drizzle/libSQL (server), React + TanStack Router/Query + chess.js + chessground (web), Zod (shared), Vitest + Testing Library.

## Global Constraints

- Node `>=22`; npm-workspaces monorepo (`@coc/shared`, `@coc/server`, `@coc/web`).
- ESM throughout: relative imports use the `.js` extension even from `.ts`/`.tsx` sources.
- Cross-boundary payloads are Zod schemas in `@coc/shared`, validated at the web boundary (mirror the existing `Leak`/`GameReview` pattern).
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Eval values shown in the UI are **White-POV centipawns**, via the existing `whitePovCp` helper (negates when Black is to move; `null` when the position has no cached eval). Browse is **cached reads only**, except the explicit Study **Analyze** action (`/position`), which runs the engine on demand.
- The on-demand `/position` route returns **409** while a sync run is active (`getActiveRunId() != null`); no interleaving.
- A position is identified by its **EPD** (4-field FEN); a full board FEN is `${epd} 0 1`.
- Test commands: server `npm run test -w @coc/server`; web `npm run test -w @coc/web`; shared `npm run test -w @coc/shared`. A trailing `-- <path>` filters to one file. Typechecks (neither `vitest` nor `vite build` typecheck): `npx tsc -p server/tsconfig.json --noEmit` and `npx tsc -p web/tsconfig.json --noEmit`.

---

### Task 1: Shared schemas for Study & Tree

**Files:**
- Modify: `shared/src/schemas.ts`
- Test: `shared/src/schemas.test.ts` (add a describe block)

**Interfaces:**
- Consumes: existing `EngineLine`, `Classification`, `Color`, `z` from this file.
- Produces: `BookSource`, `OpeningListItem`, `BookMoveStat`, `ExploreResult`, `PositionAnalysis`, `TreeChild`, `TreeChildren` schemas + inferred types, exported from `@coc/shared`.

- [ ] **Step 1: Write the failing test**

Add to `shared/src/schemas.test.ts`:

```ts
import { BookSource, OpeningListItem, ExploreResult, PositionAnalysis, TreeChild, TreeChildren } from "./schemas.js";

describe("phase-3 schemas", () => {
  it("parses an ExploreResult with nullable eval", () => {
    const v = {
      epd: "E", source: "masters", total: 200,
      bookMoves: [{ san: "e4", uci: "e2e4", count: 120, white: 60, draws: 40, black: 20 }],
      evalWhiteCp: 25, lines: [{ rank: 1, scoreCp: 25, mateIn: null, pvUci: ["e2e4"] }],
    };
    expect(ExploreResult.parse(v)).toEqual(v);
    expect(ExploreResult.parse({ ...v, evalWhiteCp: null }).evalWhiteCp).toBeNull();
    expect(BookSource.parse("rating")).toBe("rating");
  });

  it("parses a PositionAnalysis and an OpeningListItem", () => {
    const pa = { epd: "E", evalWhiteCp: -30, scoreCp: 30, mateIn: null,
      lines: [{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["d2d4"] }], depth: 18, engineVersion: "v" };
    expect(PositionAnalysis.parse(pa)).toEqual(pa);
    expect(OpeningListItem.parse({ epd: "E", eco: "B20", name: "Sicilian" }).name).toBe("Sicilian");
  });

  it("parses TreeChildren with nullable classification/avgCpLoss", () => {
    const child = { san: "e4", uci: "e2e4", epdAfter: "E2", count: 3, isMine: true,
      classification: "book", avgCpLoss: 12.5, white: 2, draws: 0, black: 1 };
    expect(TreeChild.parse(child)).toEqual(child);
    expect(TreeChild.parse({ ...child, classification: null, avgCpLoss: null }).avgCpLoss).toBeNull();
    const tc = { epd: "E", color: "white", children: [child] };
    expect(TreeChildren.parse(tc).children).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/shared -- src/schemas.test.ts`
Expected: FAIL — the new schemas are not exported.

- [ ] **Step 3: Add the schemas**

Append to `shared/src/schemas.ts`:

```ts
export const BookSource = z.enum(["masters", "rating"]);
export type BookSource = z.infer<typeof BookSource>;

export const OpeningListItem = z.object({
  epd: z.string(),
  eco: z.string(),
  name: z.string(),
});
export type OpeningListItem = z.infer<typeof OpeningListItem>;

export const BookMoveStat = z.object({
  san: z.string(),
  uci: z.string(),
  count: z.number().int(),
  white: z.number().int(),
  draws: z.number().int(),
  black: z.number().int(),
});
export type BookMoveStat = z.infer<typeof BookMoveStat>;

export const ExploreResult = z.object({
  epd: z.string(),
  source: BookSource,
  total: z.number().int(),
  bookMoves: z.array(BookMoveStat),
  // White-POV cp of this position from the cache, or null when uncached.
  evalWhiteCp: z.number().int().nullable(),
  lines: z.array(EngineLine),
});
export type ExploreResult = z.infer<typeof ExploreResult>;

export const PositionAnalysis = z.object({
  epd: z.string(),
  evalWhiteCp: z.number().int().nullable(),
  scoreCp: z.number().int().nullable(),
  mateIn: z.number().int().nullable(),
  lines: z.array(EngineLine),
  depth: z.number().int(),
  engineVersion: z.string(),
});
export type PositionAnalysis = z.infer<typeof PositionAnalysis>;

export const TreeChild = z.object({
  san: z.string(),
  uci: z.string(),
  epdAfter: z.string(),
  count: z.number().int(),
  isMine: z.boolean(),
  classification: Classification.nullable(),
  // Averaged cp-loss of your plays of this move (null when none had a cp-loss).
  avgCpLoss: z.number().nullable(),
  // Objective outcome counts; because the Tree is color-scoped these read as your own W/D/L.
  white: z.number().int(),
  draws: z.number().int(),
  black: z.number().int(),
});
export type TreeChild = z.infer<typeof TreeChild>;

export const TreeChildren = z.object({
  epd: z.string(),
  color: Color,
  children: z.array(TreeChild),
});
export type TreeChildren = z.infer<typeof TreeChildren>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/shared -- src/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/schemas.ts shared/src/schemas.test.ts
git commit -m "feat(shared): Study/Tree schemas (ExploreResult, PositionAnalysis, TreeChildren)"
```

---

### Task 2: `searchOpenings` query

**Files:**
- Create: `server/src/openings/searchOpenings.ts`
- Test: `server/src/openings/searchOpenings.test.ts` (create)

**Interfaces:**
- Consumes: `OpeningListItem` from `@coc/shared`; Drizzle `schema`, `Db`.
- Produces: `searchOpenings(db: Db, q: string, limit?: number): Promise<OpeningListItem[]>` — openings whose `name` or `eco` matches `q` (SQLite `LIKE`, case-insensitive for ASCII), ordered by name, capped at `limit` (default 50).

- [ ] **Step 1: Write the failing test**

Create `server/src/openings/searchOpenings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { searchOpenings } from "./searchOpenings.js";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE openings (epd text primary key, eco text, name text);`);
  const db = drizzle(c, { schema });
  await db.insert(schema.openings).values([
    { epd: "E1", eco: "B20", name: "Sicilian Defense" },
    { epd: "E2", eco: "B21", name: "Sicilian Defense: Smith-Morra Gambit" },
    { epd: "E3", eco: "C50", name: "Italian Game" },
  ]);
  return db;
}

describe("searchOpenings", () => {
  it("matches by name (case-insensitive) ordered by name", async () => {
    const db = await memDb();
    const r = await searchOpenings(db, "sicil");
    expect(r.map((o) => o.name)).toEqual(["Sicilian Defense", "Sicilian Defense: Smith-Morra Gambit"]);
  });
  it("matches by eco and respects the limit", async () => {
    const db = await memDb();
    expect((await searchOpenings(db, "C50")).map((o) => o.epd)).toEqual(["E3"]);
    expect(await searchOpenings(db, "sicil", 1)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/server -- src/openings/searchOpenings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/src/openings/searchOpenings.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/server -- src/openings/searchOpenings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/openings/searchOpenings.ts server/src/openings/searchOpenings.test.ts
git commit -m "feat(server): searchOpenings query for the Study picker"
```

---

### Task 3: Extract `whitePovCp` into a shared server helper

The White-POV helper currently lives in `games/gameReview.ts`. Study's `getExplore` and the on-demand analyzer both need it; extract it to `analysis/whitePov.ts` (mirroring the Phase-2 `bestMoveSan` extraction) so neither new module imports from `games/`. This is a behavior-preserving refactor — the existing game-review tests must stay green.

**Files:**
- Create: `server/src/analysis/whitePov.ts`
- Test: `server/src/analysis/whitePov.test.ts` (create)
- Modify: `server/src/games/gameReview.ts` (import + re-export `whitePovCp` instead of defining it)

**Interfaces:**
- Produces: `whitePovCp(epd: string, row: { scoreCp: number | null; mateIn: number | null } | undefined): number | null` — White-POV cp; negates when the EPD's active color is `b`; `null` when `row` is absent or both fields are null.
- `gameReview.ts` keeps re-exporting `whitePovCp` (its public surface is unchanged) and keeps using it internally.

- [ ] **Step 1: Write the failing test**

Create `server/src/analysis/whitePov.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { whitePovCp } from "./whitePov.js";

const W = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const B = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3";

describe("whitePovCp", () => {
  it("keeps white-to-move evals and negates black-to-move evals", () => {
    expect(whitePovCp(W, { scoreCp: 30, mateIn: null })).toBe(30);
    expect(whitePovCp(B, { scoreCp: 30, mateIn: null })).toBe(-30);
  });
  it("returns null for an absent or both-null row", () => {
    expect(whitePovCp(W, undefined)).toBeNull();
    expect(whitePovCp(W, { scoreCp: null, mateIn: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/server -- src/analysis/whitePov.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper**

Create `server/src/analysis/whitePov.ts`:

```ts
import { scoreToCp } from "@coc/shared";

/** White-POV centipawns for an EPD, given its cached eval row. Negates when Black is to move;
 *  null when the row is absent or carries neither a cp nor a mate score. */
export function whitePovCp(epd: string, row: { scoreCp: number | null; mateIn: number | null } | undefined): number | null {
  if (!row || (row.scoreCp === null && row.mateIn === null)) return null;
  const cp = scoreToCp(row);
  return epd.split(" ")[1] === "w" ? cp : -cp;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/server -- src/analysis/whitePov.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `gameReview.ts` to import + re-export**

In `server/src/games/gameReview.ts`:

Replace the import line:

```ts
import { scoreToCp, type GameReview, type ReviewMove, type EngineLine } from "@coc/shared";
```

with:

```ts
import { type GameReview, type ReviewMove, type EngineLine } from "@coc/shared";
import { whitePovCp } from "../analysis/whitePov.js";
```

Delete the local `whitePovCp` definition (the `export function whitePovCp(...) { ... }` block) and add, right after the imports:

```ts
export { whitePovCp };
```

(Everything else in the file — `getGameReview` and its internal `whitePovCp(...)` calls — is unchanged.)

- [ ] **Step 6: Run the game-review suite to confirm no behavior change**

Run: `npm run test -w @coc/server -- src/games/gameReview.test.ts`
Expected: PASS (unchanged — it imports `whitePovCp` from `./gameReview.js`, still exported).

- [ ] **Step 7: Commit**

```bash
git add server/src/analysis/whitePov.ts server/src/analysis/whitePov.test.ts server/src/games/gameReview.ts
git commit -m "refactor(server): extract whitePovCp helper shared by review + study"
```

---

### Task 4: `getExplore` (book + cached eval)

**Files:**
- Create: `server/src/study/getExplore.ts`
- Test: `server/src/study/getExplore.test.ts` (create)

**Interfaces:**
- Consumes: `getBook` (`book/explorerClient.js`); `whitePovCp` (Task 3); `ExploreResult`, `BookSource`, `EngineLine` from `@coc/shared`.
- Produces: `getExplore(db: Db, epd: string, source: BookSource, opts: { depth: number; engineVersion: string }): Promise<ExploreResult>` — live+cached book stats plus the *cached-only* White-POV eval + lines for the position. No engine call.

- [ ] **Step 1: Write the failing test**

Create `server/src/study/getExplore.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getExplore } from "./getExplore.js";

const EPD_W = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const EPD_B = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE position_evals (epd text, depth integer, engine_version text,
    score_cp integer, mate_in integer, lines_json text, primary key (epd, depth, engine_version));`);
  await c.execute(`CREATE TABLE book_stats (epd text, source text, total integer, moves_json text,
    fetched_at integer, primary key (epd, source));`);
  const db = drizzle(c, { schema });
  // Seed a book row for EVERY epd the tests query, so getBook always hits the cache and never
  // makes a real network call. (An unseeded epd would make getBook fetch the live Lichess explorer.)
  await db.insert(schema.bookStats).values([
    { epd: EPD_W, source: "masters", total: 200,
      movesJson: JSON.stringify([{ san: "e4", uci: "e2e4", count: 120, white: 60, draws: 40, black: 20 }]), fetchedAt: 0 },
    { epd: EPD_B, source: "masters", total: 0, movesJson: "[]", fetchedAt: 0 },
    { epd: "8/8/8/8/8/8/8/8 w - -", source: "masters", total: 0, movesJson: "[]", fetchedAt: 0 },
  ]);
  await db.insert(schema.positionEvals).values([
    { epd: EPD_W, depth: 18, engineVersion: "v", scoreCp: 30, mateIn: null,
      linesJson: JSON.stringify([{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["d2d4"] }]) },
    { epd: EPD_B, depth: 18, engineVersion: "v", scoreCp: 28, mateIn: null,
      linesJson: JSON.stringify([{ rank: 1, scoreCp: 28, mateIn: null, pvUci: ["c7c5"] }]) },
  ]);
  return db;
}

describe("getExplore", () => {
  it("returns book moves + white-POV cached eval (white to move)", async () => {
    const db = await memDb();
    const r = await getExplore(db, EPD_W, "masters", { depth: 18, engineVersion: "v" });
    expect(r.total).toBe(200);
    expect(r.bookMoves).toEqual([{ san: "e4", uci: "e2e4", count: 120, white: 60, draws: 40, black: 20 }]);
    expect(r.evalWhiteCp).toBe(30);
    expect(r.lines[0]!.pvUci).toEqual(["d2d4"]);
  });
  it("negates the eval when black is to move", async () => {
    const db = await memDb();
    const r = await getExplore(db, EPD_B, "masters", { depth: 18, engineVersion: "v" });
    expect(r.evalWhiteCp).toBe(-28); // book row absent for EPD_B -> empty book, but eval is present
    expect(r.bookMoves).toEqual([]);
    expect(r.total).toBe(0);
  });
  it("returns null eval + empty lines when uncached", async () => {
    const db = await memDb();
    const r = await getExplore(db, "8/8/8/8/8/8/8/8 w - -", "masters", { depth: 18, engineVersion: "v" });
    expect(r.evalWhiteCp).toBeNull();
    expect(r.lines).toEqual([]);
  });
});
```

> Note: the test pre-seeds `book_stats`, so `getBook` returns the cached row without any network call.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/server -- src/study/getExplore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/src/study/getExplore.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/server -- src/study/getExplore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/study/getExplore.ts server/src/study/getExplore.test.ts
git commit -m "feat(server): getExplore book + cached white-POV eval for Study"
```

---

### Task 5: `analyzeOnDemand` (on-demand engine + cache)

**Files:**
- Create: `server/src/study/analyzeOnDemand.ts`
- Test: `server/src/study/analyzeOnDemand.test.ts` (create)

**Interfaces:**
- Consumes: `Analyzer` (`analysis/orchestrator.js`); `whitePovCp` (Task 3); `toEpd`, `PositionAnalysis` from `@coc/shared`.
- Produces: `analyzeOnDemand(db: Db, engine: Analyzer, opts: { depth: number; multipv: number }, fen: string): Promise<PositionAnalysis>` — returns the cached eval if present, otherwise runs `engine.analyze`, writes `position_evals` with the exact orchestrator row shape (`onConflictDoNothing`), and returns the White-POV `PositionAnalysis`.

- [ ] **Step 1: Write the failing test**

Create `server/src/study/analyzeOnDemand.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { analyzeOnDemand } from "./analyzeOnDemand.js";

const FEN_B = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE position_evals (epd text, depth integer, engine_version text,
    score_cp integer, mate_in integer, lines_json text, primary key (epd, depth, engine_version));`);
  return drizzle(c, { schema });
}

function fakeEngine() {
  return {
    version: "v",
    analyze: vi.fn(async (fen: string, depth: number, _mpv: number) => ({
      epd: fen.split(" ").slice(0, 4).join(" "), depth, engineVersion: "v",
      lines: [{ rank: 1, scoreCp: 28, mateIn: null, pvUci: ["c7c5"] }],
    })),
  };
}

describe("analyzeOnDemand", () => {
  it("runs the engine on a miss, caches, and returns white-POV eval", async () => {
    const db = await memDb();
    const engine = fakeEngine();
    const r = await analyzeOnDemand(db, engine, { depth: 18, multipv: 3 }, FEN_B);
    expect(engine.analyze).toHaveBeenCalledTimes(1);
    expect(r.scoreCp).toBe(28);
    expect(r.evalWhiteCp).toBe(-28); // black to move -> negate
    expect(r.lines[0]!.pvUci).toEqual(["c7c5"]);
    const cached = await db.select().from(schema.positionEvals);
    expect(cached).toHaveLength(1);
  });
  it("short-circuits on a cache hit (no second engine call)", async () => {
    const db = await memDb();
    const engine = fakeEngine();
    await analyzeOnDemand(db, engine, { depth: 18, multipv: 3 }, FEN_B);
    await analyzeOnDemand(db, engine, { depth: 18, multipv: 3 }, FEN_B);
    expect(engine.analyze).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/server -- src/study/analyzeOnDemand.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/src/study/analyzeOnDemand.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { toEpd, type PositionAnalysis, type EngineLine } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import type { Analyzer } from "../analysis/orchestrator.js";
import { whitePovCp } from "../analysis/whitePov.js";

export interface AnalyzeOnDemandOpts { depth: number; multipv: number }

/** Cached-or-fresh Stockfish analysis of one full FEN. Writes the cache identically to the sync
 *  orchestrator (same key + lines layout) so on-demand and sync evals are interchangeable. */
export async function analyzeOnDemand(db: Db, engine: Analyzer, opts: AnalyzeOnDemandOpts, fen: string): Promise<PositionAnalysis> {
  const epd = toEpd(fen);
  const key = and(eq(schema.positionEvals.epd, epd), eq(schema.positionEvals.depth, opts.depth),
    eq(schema.positionEvals.engineVersion, engine.version));

  let row = (await db.select().from(schema.positionEvals).where(key))[0];
  if (!row) {
    const res = await engine.analyze(fen, opts.depth, opts.multipv);
    const best = res.lines[0];
    await db.insert(schema.positionEvals).values({
      epd, depth: opts.depth, engineVersion: engine.version,
      scoreCp: best?.scoreCp ?? null, mateIn: best?.mateIn ?? null,
      linesJson: JSON.stringify(res.lines),
    }).onConflictDoNothing();
    row = (await db.select().from(schema.positionEvals).where(key))[0];
  }

  const lines = JSON.parse(row!.linesJson) as EngineLine[];
  return {
    epd, evalWhiteCp: whitePovCp(epd, row!),
    scoreCp: row!.scoreCp, mateIn: row!.mateIn, lines,
    depth: opts.depth, engineVersion: engine.version,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/server -- src/study/analyzeOnDemand.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/study/analyzeOnDemand.ts server/src/study/analyzeOnDemand.test.ts
git commit -m "feat(server): analyzeOnDemand on-demand engine for the Study Analyze button"
```

---

### Task 6: `getTreeChildren` (repertoire navigator)

**Files:**
- Create: `server/src/tree/getTreeChildren.ts`
- Test: `server/src/tree/getTreeChildren.test.ts` (create)

**Interfaces:**
- Consumes: `TreeChildren`, `TreeChild`, `Color`, `Classification` from `@coc/shared`; Drizzle `schema`, `Db`.
- Produces: `getTreeChildren(db: Db, color: Color, epd?: string): Promise<TreeChildren>` — your played moves from `epd` (default `START_EPD`) across your games of `color`, aggregated by `uci`: `count`, objective `white`/`draws`/`black` derived from `(games.result, color)`, `isMine`, the move's `classification`, and averaged `cpLoss`. Sorted by `count` desc. Also exports `START_EPD`.

- [ ] **Step 1: Write the failing test**

Create `server/src/tree/getTreeChildren.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getTreeChildren, START_EPD } from "./getTreeChildren.js";

const AFTER_E4_EPD = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE games (id text primary key, source text, url text, username text,
    my_color text, result text, time_class text, end_time integer, eco text, opening_name text,
    my_rating integer, opp_rating integer, pgn text);`);
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  const db = drizzle(c, { schema });
  // two WHITE games: both open 1.e4 (your move), one win one loss
  for (const [gid, result, cp] of [["g1", "win", 5], ["g2", "loss", 80]] as const) {
    await db.insert(schema.games).values({ id: gid, source: "chesscom", url: null, username: "me",
      myColor: "white", result, timeClass: "rapid", endTime: 1, eco: "B20",
      openingName: "Sicilian", myRating: 1500, oppRating: 1500, pgn: "" });
    await db.insert(schema.moves).values({ gameId: gid, ply: 1, fenBefore: "F", fenAfter: "F2",
      epdBefore: START_EPD, epdAfter: AFTER_E4_EPD, san: "e4", uci: "e2e4", isMine: true,
      bookStatus: "in_book", evalBestCp: 30, evalPlayedCp: 25, cpLoss: cp, classification: "book" });
  }
  // a BLACK game opening 1.e4 must be excluded from the white tree
  await db.insert(schema.games).values({ id: "g3", source: "chesscom", url: null, username: "me",
    myColor: "black", result: "win", timeClass: "rapid", endTime: 1, eco: "B20",
    openingName: "Sicilian", myRating: 1500, oppRating: 1500, pgn: "" });
  await db.insert(schema.moves).values({ gameId: "g3", ply: 1, fenBefore: "F", fenAfter: "F2",
    epdBefore: START_EPD, epdAfter: AFTER_E4_EPD, san: "e4", uci: "e2e4", isMine: false,
    bookStatus: "in_book", evalBestCp: null, evalPlayedCp: null, cpLoss: null, classification: null });
  return db;
}

describe("getTreeChildren", () => {
  it("aggregates your color's moves from a position with objective W/D/L", async () => {
    const db = await memDb();
    const t = await getTreeChildren(db, "white", START_EPD);
    expect(t.children).toHaveLength(1);
    const e4 = t.children[0]!;
    expect(e4).toMatchObject({ san: "e4", uci: "e2e4", epdAfter: AFTER_E4_EPD, count: 2,
      isMine: true, classification: "book", white: 1, draws: 0, black: 1 });
    expect(e4.avgCpLoss).toBeCloseTo(42.5); // (5 + 80) / 2
  });
  it("defaults to the start position and returns an empty leaf", async () => {
    const db = await memDb();
    expect((await getTreeChildren(db, "white")).children).toHaveLength(1); // default epd = START_EPD
    expect((await getTreeChildren(db, "white", "nowhere w - -")).children).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/server -- src/tree/getTreeChildren.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/src/tree/getTreeChildren.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/server -- src/tree/getTreeChildren.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/tree/getTreeChildren.ts server/src/tree/getTreeChildren.test.ts
git commit -m "feat(server): getTreeChildren repertoire navigator query"
```

---

### Task 7: Wire routes (`/openings`, `/explore`, `/position`, `/tree`)

**Files:**
- Modify: `server/src/routes/app.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/routes/app.test.ts` (add cases)

**Interfaces:**
- Consumes: `searchOpenings` (T2), `getExplore` (T4), `analyzeOnDemand` (T5), `getTreeChildren` (T6); `OpeningListItem`, `ExploreResult`, `PositionAnalysis`, `TreeChildren`, `BookSource`, `Color` from `@coc/shared`.
- Produces (AppDeps): `getOpenings?`, `explore?`, `analyzePosition?`, `getTree?`. Routes: `GET /openings?q=`, `GET /explore?epd=&source=`, `GET /position?fen=` (409 when a run is active), `GET /tree?color=&epd=?`.

- [ ] **Step 1: Write the failing test**

Add to `server/src/routes/app.test.ts`:

```ts
import { ExploreResult, PositionAnalysis, TreeChildren, OpeningListItem } from "@coc/shared";

describe("study + tree routes", () => {
  const opening = OpeningListItem.parse({ epd: "E", eco: "B20", name: "Sicilian" });
  const explore = ExploreResult.parse({ epd: "E", source: "masters", total: 0, bookMoves: [],
    evalWhiteCp: null, lines: [] });
  const analysis = PositionAnalysis.parse({ epd: "E", evalWhiteCp: 20, scoreCp: 20, mateIn: null,
    lines: [], depth: 18, engineVersion: "v" });
  const tree = TreeChildren.parse({ epd: "E", color: "white", children: [] });

  it("GET /openings passes the query through", async () => {
    let seen = "";
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getOpenings: async (q) => { seen = q; return [opening]; } });
    expect(await (await app.request("/openings?q=sic")).json()).toEqual([opening]);
    expect(seen).toBe("sic");
  });

  it("GET /explore passes epd + source", async () => {
    let seen: [string, string] | null = null;
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      explore: async (epd, source) => { seen = [epd, source]; return explore; } });
    expect(await (await app.request("/explore?epd=E&source=masters")).json()).toEqual(explore);
    expect(seen).toEqual(["E", "masters"]);
  });

  it("GET /position returns analysis, or 409 while a run is active", async () => {
    const ok = createApp({ runStore: new RunStore(), startSync: async () => {},
      getActiveRunId: () => null, analyzePosition: async () => analysis });
    expect(await (await ok.request("/position?fen=" + encodeURIComponent("E w - - 0 1"))).json()).toEqual(analysis);
    const busy = createApp({ runStore: new RunStore(), startSync: async () => {},
      getActiveRunId: () => "run1", analyzePosition: async () => analysis });
    expect((await busy.request("/position?fen=" + encodeURIComponent("E w - - 0 1"))).status).toBe(409);
  });

  it("GET /tree passes color + epd", async () => {
    let seen: [string, string | undefined] | null = null;
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getTree: async (color, epd) => { seen = [color, epd]; return tree; } });
    expect(await (await app.request("/tree?color=white&epd=E")).json()).toEqual(tree);
    expect(seen).toEqual(["white", "E"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/server -- src/routes/app.test.ts`
Expected: FAIL — the new deps/routes do not exist.

- [ ] **Step 3: Update `app.ts`**

In `server/src/routes/app.ts`, extend the `@coc/shared` import to add the new types:

```ts
import { SyncRequest, type Leak, type GameSummary, type GameReview, type LeakOccurrence,
  type OpeningListItem, type ExploreResult, type PositionAnalysis, type TreeChildren } from "@coc/shared";
```

In `AppDeps`, add after the existing `getOccurrences` line:

```ts
  getOpenings?: (q: string) => Promise<OpeningListItem[]>;
  explore?: (epd: string, source: "masters" | "rating") => Promise<ExploreResult>;
  analyzePosition?: (fen: string) => Promise<PositionAnalysis>;
  getTree?: (color: "white" | "black", epd?: string) => Promise<TreeChildren>;
```

Add the four routes to the chain (place them after the existing `.get("/games/:id", ...)` block):

```ts
    .get("/openings", zValidator("query", z.object({ q: z.string() })), async (c) =>
      c.json((await deps.getOpenings?.(c.req.valid("query").q)) ?? []))
    .get("/explore", zValidator("query", z.object({ epd: z.string(), source: z.enum(["masters", "rating"]) })), async (c) => {
      const { epd, source } = c.req.valid("query");
      const r = await deps.explore?.(epd, source);
      return r ? c.json(r) : c.json({ error: "explore unavailable" }, 503);
    })
    .get("/position", zValidator("query", z.object({ fen: z.string() })), async (c) => {
      if (deps.getActiveRunId?.()) return c.json({ error: "engine busy: sync in progress" }, 409);
      const r = await deps.analyzePosition?.(c.req.valid("query").fen);
      return r ? c.json(r) : c.json({ error: "analysis unavailable" }, 503);
    })
    .get("/tree", zValidator("query", z.object({ color: z.enum(["white", "black"]), epd: z.string().optional() })), async (c) => {
      const { color, epd } = c.req.valid("query");
      const r = await deps.getTree?.(color, epd);
      return r ? c.json(r) : c.json({ epd: epd ?? "", color, children: [] }, 200);
    })
```

- [ ] **Step 4: Update `index.ts` wiring**

In `server/src/index.ts`, add imports:

```ts
import { searchOpenings } from "./openings/searchOpenings.js";
import { getExplore } from "./study/getExplore.js";
import { analyzeOnDemand } from "./study/analyzeOnDemand.js";
import { getTreeChildren } from "./tree/getTreeChildren.js";
```

Add to the `createApp({ ... })` deps (after `getOccurrences`):

```ts
  getOpenings: (q) => searchOpenings(db, q),
  explore: (epd, source) => getExplore(db, epd, source, { depth: DEPTH, engineVersion: engineVersion() }),
  analyzePosition: async (fen) => {
    if (!engineStarted) { await engine.start(); engineStarted = true; }
    const analyzer = { version: engineVersion(), analyze: (f: string, d: number, mpv: number) => engine.analyze(f, d, mpv) };
    return analyzeOnDemand(db, analyzer, { depth: DEPTH, multipv: MULTIPV }, fen);
  },
  getTree: (color, epd) => getTreeChildren(db, color, epd),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @coc/server -- src/routes/app.test.ts`
Expected: PASS. Then the full server suite + typecheck:
Run: `npm run test -w @coc/server` — Expected: PASS.
Run: `npx tsc -p server/tsconfig.json --noEmit` — Expected: clean (exit 0).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/app.ts server/src/index.ts server/src/routes/app.test.ts
git commit -m "feat(server): /openings /explore /position(409) /tree browse routes"
```

---

### Task 8: `ExplorerMoveTable` component

**Files:**
- Create: `web/src/components/ExplorerMoveTable.tsx`
- Test: `web/src/components/ExplorerMoveTable.test.tsx` (create)

**Interfaces:**
- Consumes: `Classification` from `@coc/shared`; `ClassificationChip` (existing).
- Produces: `ExplorerRow` interface and `ExplorerMoveTable({ rows, onSelect }: { rows: ExplorerRow[]; onSelect: (uci: string) => void })` — one clickable row per move (SAN + optional classification chip, count, a W/D/L bar). Each row has `data-testid={"move-row-" + uci}`. Empty `rows` renders a "No moves" note.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ExplorerMoveTable.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExplorerMoveTable, type ExplorerRow } from "./ExplorerMoveTable.js";

const rows: ExplorerRow[] = [
  { san: "e4", uci: "e2e4", count: 5, white: 3, draws: 1, black: 1, isMine: true, classification: "book", avgCpLoss: 5 },
  { san: "d4", uci: "d2d4", count: 2, white: 1, draws: 0, black: 1 },
];

describe("ExplorerMoveTable", () => {
  it("renders rows with chips and reports clicks by uci", () => {
    const onSelect = vi.fn();
    render(<ExplorerMoveTable rows={rows} onSelect={onSelect} />);
    expect(screen.getByText("e4")).toBeInTheDocument();
    expect(screen.getByText("book")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-row-d2d4"));
    expect(onSelect).toHaveBeenCalledWith("d2d4");
  });
  it("shows an empty state", () => {
    render(<ExplorerMoveTable rows={[]} onSelect={() => {}} />);
    expect(screen.getByText(/No moves/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/components/ExplorerMoveTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `web/src/components/ExplorerMoveTable.tsx`:

```tsx
import type { Classification } from "@coc/shared";
import { ClassificationChip } from "./ClassificationChip.js";

export interface ExplorerRow {
  san: string; uci: string; count: number;
  white: number; draws: number; black: number;
  isMine?: boolean; classification?: Classification | null; avgCpLoss?: number | null;
}

export function ExplorerMoveTable({ rows, onSelect }: { rows: ExplorerRow[]; onSelect: (uci: string) => void }) {
  if (rows.length === 0) return <p style={{ color: "#888" }}>No moves from this position.</p>;
  return (
    <table style={{ borderCollapse: "collapse", width: 280 }}>
      <tbody>
        {rows.map((r) => {
          const total = r.white + r.draws + r.black || 1;
          return (
            <tr key={r.uci} data-testid={"move-row-" + r.uci} onClick={() => onSelect(r.uci)} style={{ cursor: "pointer" }}>
              <td style={{ fontWeight: 600, padding: "2px 6px" }}>
                {r.san}
                {r.classification && <ClassificationChip classification={r.classification} bookStatus={null} />}
              </td>
              <td style={{ padding: "2px 6px", color: "#888" }}>{r.count}</td>
              <td style={{ width: 120 }}>
                <div style={{ display: "flex", height: 10, width: 120, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${(r.white / total) * 100}%`, background: "#eee" }} />
                  <div style={{ width: `${(r.draws / total) * 100}%`, background: "#999" }} />
                  <div style={{ width: `${(r.black / total) * 100}%`, background: "#333" }} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/web -- src/components/ExplorerMoveTable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ExplorerMoveTable.tsx web/src/components/ExplorerMoveTable.test.tsx
git commit -m "feat(web): ExplorerMoveTable with W/D/L bar + classification chips"
```

---

### Task 9: `ExplorerWorkspace` component (+ Chessboard move input)

**Files:**
- Modify: `web/src/components/Chessboard.tsx` (add optional move input; stays `viewOnly` when no `onMove`)
- Create: `web/src/components/ExplorerWorkspace.tsx`
- Test: `web/src/components/ExplorerWorkspace.test.tsx` (create)

**Interfaces:**
- Consumes: `Chessboard`, `EvalBar`, `ExplorerMoveTable` + `ExplorerRow` (Task 8).
- Produces: `ExplorerWorkspace(props)` — board + eval bar + breadcrumb + move table + `controls`/`detail` slots. Props: `{ fen, evalWhiteCp, rows, path, onSelectMove, onNavigate, onReset, allowFreeMove?, onPlayMove?, dests?, movableColor?, controls?, detail? }`.
- Chessboard gains optional `onMove?: (orig, dest) => void`, `dests?: Map<string,string[]>`, `movableColor?: "white"|"black"`. When `onMove` is absent it is `viewOnly` (existing behavior — Review/leaks unaffected).

> Note: `Chessboard` wraps chessground (real DOM/SVG) and is not unit-tested in jsdom — consistent with the existing codebase, components that use it mock it. The move-input change is exercised via the running app + the web build/typecheck; `ExplorerWorkspace`'s test mocks `Chessboard`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ExplorerWorkspace.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ExplorerRow } from "./ExplorerMoveTable.js";

vi.mock("./Chessboard.js", () => ({
  Chessboard: ({ fen, onMove }: { fen: string; onMove?: (o: string, d: string) => void }) => (
    <div data-testid="board" data-fen={fen}>
      {onMove && <button data-testid="free-move" onClick={() => onMove("e2", "e4")}>m</button>}
    </div>
  ),
}));

import { ExplorerWorkspace } from "./ExplorerWorkspace.js";

const rows: ExplorerRow[] = [{ san: "e4", uci: "e2e4", count: 3, white: 2, draws: 0, black: 1 }];

describe("ExplorerWorkspace", () => {
  it("renders board/rows/breadcrumb/slots and reports selections + free moves", () => {
    const onSelectMove = vi.fn(), onNavigate = vi.fn(), onReset = vi.fn(), onPlayMove = vi.fn();
    render(<ExplorerWorkspace fen="FEN" evalWhiteCp={20} rows={rows} path={["d4", "Nf6"]}
      onSelectMove={onSelectMove} onNavigate={onNavigate} onReset={onReset}
      allowFreeMove onPlayMove={onPlayMove} controls={<span>ctrl</span>} detail={<span>det</span>} />);
    expect(screen.getByTestId("board")).toHaveAttribute("data-fen", "FEN");
    expect(screen.getByText("e4")).toBeInTheDocument();
    expect(screen.getByText("ctrl")).toBeInTheDocument();
    expect(screen.getByText("det")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-row-e2e4"));
    expect(onSelectMove).toHaveBeenCalledWith("e2e4");
    fireEvent.click(screen.getByTestId("crumb-1"));
    expect(onNavigate).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTestId("free-move"));
    expect(onPlayMove).toHaveBeenCalledWith("e2", "e4");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/components/ExplorerWorkspace.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Extend `Chessboard`**

Replace `web/src/components/Chessboard.tsx` with:

```tsx
import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

export interface BoardArrow { orig: string; dest: string; brush?: "green" | "red" | "blue" }

export function Chessboard({ fen, arrows = [], size = 320, onMove, dests, movableColor }: {
  fen: string; arrows?: BoardArrow[]; size?: number;
  onMove?: (orig: string, dest: string) => void;
  dests?: Map<string, string[]>; movableColor?: "white" | "black";
}) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, { fen, viewOnly: !onMove, coordinates: false });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    api.current?.set({
      fen,
      viewOnly: !onMove,
      movable: onMove
        ? { free: false, color: movableColor, dests: dests as unknown as Map<Key, Key[]>,
            events: { after: (orig, dest) => onMove(orig as string, dest as string) } }
        : undefined,
      drawable: { autoShapes: arrows.map((a) => ({ orig: a.orig as Key, dest: a.dest as Key, brush: a.brush ?? "green" })) },
    });
  }, [fen, arrows, onMove, dests, movableColor]);

  return <div ref={el} style={{ width: size, height: size }} />;
}
```

- [ ] **Step 4: Implement `ExplorerWorkspace`**

Create `web/src/components/ExplorerWorkspace.tsx`:

```tsx
import type { ReactNode } from "react";
import { Chessboard } from "./Chessboard.js";
import { EvalBar } from "./EvalBar.js";
import { ExplorerMoveTable, type ExplorerRow } from "./ExplorerMoveTable.js";

export function ExplorerWorkspace({
  fen, evalWhiteCp, rows, path, onSelectMove, onNavigate, onReset,
  allowFreeMove = false, onPlayMove, dests, movableColor, controls, detail,
}: {
  fen: string; evalWhiteCp: number | null; rows: ExplorerRow[];
  path: string[]; onSelectMove: (uci: string) => void;
  onNavigate: (index: number) => void; onReset: () => void;
  allowFreeMove?: boolean; onPlayMove?: (orig: string, dest: string) => void;
  dests?: Map<string, string[]>; movableColor?: "white" | "black";
  controls?: ReactNode; detail?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <EvalBar cp={evalWhiteCp ?? 0} />
        <Chessboard fen={fen} onMove={allowFreeMove ? onPlayMove : undefined} dests={dests} movableColor={movableColor} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {controls}
        <div data-testid="breadcrumb" style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 280 }}>
          <button onClick={onReset} style={{ cursor: "pointer" }}>start</button>
          {path.map((san, i) => (
            <button key={i} data-testid={"crumb-" + i} onClick={() => onNavigate(i)} style={{ cursor: "pointer" }}>{san}</button>
          ))}
        </div>
        <ExplorerMoveTable rows={rows} onSelect={onSelectMove} />
        {detail}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @coc/web -- src/components/ExplorerWorkspace.test.tsx`
Expected: PASS. Then run the full web suite to confirm Review/leaks (which use `Chessboard`) still pass:
Run: `npm run test -w @coc/web` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Chessboard.tsx web/src/components/ExplorerWorkspace.tsx web/src/components/ExplorerWorkspace.test.tsx
git commit -m "feat(web): ExplorerWorkspace + optional Chessboard move input"
```

---

### Task 10: `OpeningPicker` component

**Files:**
- Create: `web/src/components/OpeningPicker.tsx`
- Test: `web/src/components/OpeningPicker.test.tsx` (create)

**Interfaces:**
- Consumes: `OpeningListItem` from `@coc/shared`; `api.openings.$get`; TanStack Query.
- Produces: `OpeningPicker({ onPick }: { onPick: (o: OpeningListItem) => void })` — a search input (`placeholder="search openings"`) that queries `/openings?q=` when the term is ≥2 chars and lists results; each result is a button `data-testid={"opening-" + epd}` that calls `onPick`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/OpeningPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OpeningListItem } from "@coc/shared";

const items: OpeningListItem[] = [{ epd: "E1", eco: "B20", name: "Sicilian Defense" }];
vi.mock("../api/client.js", () => ({
  api: { openings: { $get: vi.fn(async () => ({ json: async () => items })) } },
}));

async function renderPicker() {
  const { OpeningPicker } = await import("./OpeningPicker.js");
  const onPick = vi.fn();
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><OpeningPicker onPick={onPick} /></QueryClientProvider>);
  return onPick;
}

describe("OpeningPicker", () => {
  beforeEach(() => vi.clearAllMocks());
  it("searches and reports the picked opening", async () => {
    const onPick = await renderPicker();
    fireEvent.change(screen.getByPlaceholderText("search openings"), { target: { value: "sic" } });
    await waitFor(() => expect(screen.getByText("Sicilian Defense")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("opening-E1"));
    expect(onPick).toHaveBeenCalledWith(items[0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/components/OpeningPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `web/src/components/OpeningPicker.tsx`:

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OpeningListItem } from "@coc/shared";
import { api } from "../api/client.js";

export function OpeningPicker({ onPick }: { onPick: (o: OpeningListItem) => void }) {
  const [q, setQ] = useState("");
  const { data: results = [] } = useQuery({
    queryKey: ["openings", q],
    enabled: q.trim().length >= 2,
    queryFn: async () => (await (await api.openings.$get({ query: { q } })).json()) as OpeningListItem[],
  });
  return (
    <div>
      <input placeholder="search openings" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul style={{ listStyle: "none", padding: 0, maxWidth: 360 }}>
        {results.map((o) => (
          <li key={o.epd}>
            <button data-testid={"opening-" + o.epd} onClick={() => onPick(o)} style={{ cursor: "pointer" }}>
              <b>{o.eco}</b> {o.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @coc/web -- src/components/OpeningPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/OpeningPicker.tsx web/src/components/OpeningPicker.test.tsx
git commit -m "feat(web): OpeningPicker search component"
```

---

### Task 11: `StudyPage` + `/study` route

**Files:**
- Create: `web/src/routes/study.tsx`
- Modify: `web/src/router.tsx` (register `/study` with `validateSearch`)
- Test: `web/src/routes/study.test.tsx` (create)

**Interfaces:**
- Consumes: `ExplorerWorkspace` (T9), `OpeningPicker` (T10), `ExplorerRow` type (T8); `api.explore.$get` + `api.position.$get`; `chess.js`; `toEpd`, `ExploreResult`, `PositionAnalysis`, `BookSource` from `@coc/shared`.
- Produces: `StudyPage` — if `?epd=` is present it studies that position, else shows `OpeningPicker`. Drives the line via a `chess.js` game; auto-fetches `/explore`; **Analyze** button → `/position` (handles 409); free play + book-move clicks push moves; masters/rating source toggle.

- [ ] **Step 1: Write the failing test**

Create `web/src/routes/study.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ExploreResult, PositionAnalysis } from "@coc/shared";

const EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const explore: ExploreResult = { epd: EPD, source: "masters", total: 200,
  bookMoves: [{ san: "e4", uci: "e2e4", count: 120, white: 60, draws: 40, black: 20 }],
  evalWhiteCp: 20, lines: [] };
const analysis: PositionAnalysis = { epd: EPD, evalWhiteCp: 20, scoreCp: 20, mateIn: null, lines: [], depth: 18, engineVersion: "v" };

vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({ epd: EPD, source: "masters" }) }));
vi.mock("../components/Chessboard.js", () => ({ Chessboard: ({ fen }: { fen: string }) => <div data-testid="board" data-fen={fen} /> }));
const positionGet = vi.fn(async () => ({ status: 200, json: async () => analysis }));
vi.mock("../api/client.js", () => ({
  api: {
    explore: { $get: vi.fn(async () => ({ json: async () => explore })) },
    position: { $get: (...a: unknown[]) => positionGet(...a) },
    openings: { $get: vi.fn(async () => ({ json: async () => [] })) },
  },
}));

async function renderPage() {
  const { StudyPage } = await import("./study.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><StudyPage /></QueryClientProvider>);
}

describe("StudyPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("loads explore for the deep-linked position and Analyze calls /position", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("e4")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Analyze"));
    await waitFor(() => expect(positionGet).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/routes/study.test.tsx`
Expected: FAIL — `./study.js` not found.

- [ ] **Step 3: Implement `StudyPage`**

Create `web/src/routes/study.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Chess } from "chess.js";
import { toEpd, type ExploreResult, type PositionAnalysis, type BookSource } from "@coc/shared";
import { api } from "../api/client.js";
import { ExplorerWorkspace } from "../components/ExplorerWorkspace.js";
import { OpeningPicker } from "../components/OpeningPicker.js";
import type { ExplorerRow } from "../components/ExplorerMoveTable.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const fenForEpd = (epd: string) => `${epd} 0 1`;

export function StudyPage() {
  const search = useSearch({ from: "/study" });
  const [pickedEpd, setPickedEpd] = useState<string | null>(null);
  const [moves, setMoves] = useState<string[]>([]);
  const [source, setSource] = useState<BookSource>(search.source ?? "masters");

  const rootEpd = search.epd ?? pickedEpd;

  const game = useMemo(() => {
    if (!rootEpd) return null;
    const c = new Chess(fenForEpd(rootEpd));
    for (const san of moves) { try { c.move(san); } catch { break; } }
    return c;
  }, [rootEpd, moves]);

  const fen = game ? game.fen() : START_FEN;
  const epd = game ? toEpd(fen) : "";

  const { data: explore } = useQuery({
    queryKey: ["explore", epd, source],
    enabled: !!game,
    queryFn: async () => (await (await api.explore.$get({ query: { epd, source } })).json()) as ExploreResult,
  });

  const qc = useQueryClient();
  const analyze = useMutation({
    mutationFn: async (): Promise<PositionAnalysis | "busy"> => {
      const res = await api.position.$get({ query: { fen } });
      if (res.status === 409) return "busy";
      return (await res.json()) as PositionAnalysis;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["explore", epd, source] }),
  });

  const dests = useMemo(() => {
    const m = new Map<string, string[]>();
    if (game) for (const mv of game.moves({ verbose: true })) {
      const arr = m.get(mv.from) ?? []; arr.push(mv.to); m.set(mv.from, arr);
    }
    return m;
  }, [game]);

  function pushUci(uci: string) {
    if (!game) return;
    const c = new Chess(game.fen());
    const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci.slice(4, 5) || "q") });
    if (mv) setMoves((m) => [...m, mv.san]);
  }

  if (!rootEpd) {
    return (
      <div>
        <h1>Study</h1>
        <OpeningPicker onPick={(o) => { setPickedEpd(o.epd); setMoves([]); }} />
      </div>
    );
  }

  const rows: ExplorerRow[] = (explore?.bookMoves ?? []).map((b) => ({
    san: b.san, uci: b.uci, count: b.count, white: b.white, draws: b.draws, black: b.black,
  }));

  const controls = (
    <select aria-label="book source" value={source} onChange={(e) => setSource(e.target.value as BookSource)}>
      <option value="masters">masters</option>
      <option value="rating">my rating</option>
    </select>
  );

  const detail = (
    <div>
      <button onClick={() => analyze.mutate()} disabled={analyze.isPending}>
        {analyze.isPending ? "Analyzing…" : "Analyze"}
      </button>
      {analyze.data === "busy" && <span style={{ color: "#c0392b", marginLeft: 8 }}>engine busy (sync running)</span>}
      {(explore?.lines.length ?? 0) > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>
          {explore!.lines.map((l) => (
            <li key={l.rank}>{l.mateIn !== null ? `#${l.mateIn}` : ((l.scoreCp ?? 0) / 100).toFixed(2)} &mdash; {l.pvUci[0]}</li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div>
      <h1>Study</h1>
      <ExplorerWorkspace
        fen={fen} evalWhiteCp={explore?.evalWhiteCp ?? null} rows={rows} path={moves}
        onSelectMove={pushUci} onNavigate={(i) => setMoves((m) => m.slice(0, i + 1))} onReset={() => setMoves([])}
        allowFreeMove onPlayMove={(orig, dest) => pushUci(orig + dest)}
        dests={dests} movableColor={game!.turn() === "w" ? "white" : "black"}
        controls={controls} detail={detail}
      />
    </div>
  );
}
```

- [ ] **Step 4: Register the `/study` route in `router.tsx`**

In `web/src/router.tsx`, add the import:

```ts
import { StudyPage } from "./routes/study.js";
```

Add the route definition (after `reviewRoute`):

```ts
const studyRoute = createRoute({
  getParentRoute: () => rootRoute, path: "/study", component: StudyPage,
  validateSearch: (s: Record<string, unknown>): { epd?: string; source?: "masters" | "rating" } => {
    const epd = typeof s.epd === "string" ? s.epd : undefined;
    const source = s.source === "rating" ? "rating" : s.source === "masters" ? "masters" : undefined;
    return { ...(epd ? { epd } : {}), ...(source ? { source } : {}) };
  },
});
```

Add `studyRoute` to the `addChildren` array:

```ts
const routeTree = rootRoute.addChildren([dashboardRoute, leaksRoute, gamesRoute, reviewRoute, studyRoute]);
```

- [ ] **Step 5: Run test + typecheck**

Run: `npm run test -w @coc/web -- src/routes/study.test.tsx`
Expected: PASS.
Run: `npx tsc -p web/tsconfig.json --noEmit`
Expected: clean (validates `useSearch({ from: "/study" })` typing and the chess.js usage).

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/study.tsx web/src/router.tsx web/src/routes/study.test.tsx
git commit -m "feat(web): Study page + /study route (book, analyze, free play)"
```

---

### Task 12: `TreePage` + `/tree` route

**Files:**
- Create: `web/src/routes/tree.tsx`
- Modify: `web/src/router.tsx` (register `/tree`)
- Test: `web/src/routes/tree.test.tsx` (create)

**Interfaces:**
- Consumes: `ExplorerWorkspace` (T9), `ExplorerRow` type (T8); `api.tree.$get`; TanStack `Link`; `TreeChildren`, `Color` from `@coc/shared`.
- Produces: `TreePage` — a color toggle, a navigation path from the start position, each node fetching `/tree?color=&epd=`; clicking a child descends to its `epdAfter`; the `detail` slot carries a **"Study this position"** `Link` for the current position. No free play, no Analyze.

> Spec note: the spec said each Tree *row* carries a Study link; this implements one **current-position** Study link in the `detail` slot instead — it keeps `ExplorerMoveTable` generic and still delivers Tree→Study deep-linking. (Documented deviation; flagged in self-review.)

- [ ] **Step 1: Write the failing test**

Create `web/src/routes/tree.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TreeChildren } from "@coc/shared";

const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const root: TreeChildren = { epd: START_EPD, color: "white",
  children: [{ san: "e4", uci: "e2e4", epdAfter: "AFTER", count: 3, isMine: true,
    classification: "book", avgCpLoss: 10, white: 2, draws: 0, black: 1 }] };

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search }: { children: React.ReactNode; search: { epd: string } }) =>
    <a data-testid="study-link" data-epd={search.epd}>{children}</a>,
}));
vi.mock("../components/Chessboard.js", () => ({ Chessboard: ({ fen }: { fen: string }) => <div data-testid="board" data-fen={fen} /> }));
const treeGet = vi.fn(async () => ({ json: async () => root }));
vi.mock("../api/client.js", () => ({ api: { tree: { $get: (...a: unknown[]) => treeGet(...a) } } }));

async function renderPage() {
  const { TreePage } = await import("./tree.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><TreePage /></QueryClientProvider>);
}

describe("TreePage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("lists your moves from the start and deep-links the current position to Study", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("e4")).toBeInTheDocument());
    expect(screen.getByTestId("study-link")).toHaveAttribute("data-epd", START_EPD);
  });
});
```

(Add `import type React from "react";` at the top if the file does not already import React.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/routes/tree.test.tsx`
Expected: FAIL — `./tree.js` not found.

- [ ] **Step 3: Implement `TreePage`**

Create `web/src/routes/tree.tsx`:

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { TreeChildren, Color } from "@coc/shared";
import { api } from "../api/client.js";
import { ExplorerWorkspace } from "../components/ExplorerWorkspace.js";
import type { ExplorerRow } from "../components/ExplorerMoveTable.js";

const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const fenForEpd = (epd: string) => `${epd} 0 1`;

export function TreePage() {
  const [color, setColor] = useState<Color>("white");
  const [path, setPath] = useState<{ san: string; epd: string }[]>([]);
  const epd = path.length ? path[path.length - 1]!.epd : START_EPD;

  const { data: tree } = useQuery({
    queryKey: ["tree", color, epd],
    queryFn: async () => (await (await api.tree.$get({ query: { color, epd } })).json()) as TreeChildren,
  });

  const rows: ExplorerRow[] = (tree?.children ?? []).map((c) => ({
    san: c.san, uci: c.uci, count: c.count, white: c.white, draws: c.draws, black: c.black,
    isMine: c.isMine, classification: c.classification, avgCpLoss: c.avgCpLoss,
  }));

  function descend(uci: string) {
    const child = tree?.children.find((c) => c.uci === uci);
    if (child) setPath((p) => [...p, { san: child.san, epd: child.epdAfter }]);
  }

  const controls = (
    <select aria-label="repertoire color" value={color}
      onChange={(e) => { setColor(e.target.value as Color); setPath([]); }}>
      <option value="white">white</option>
      <option value="black">black</option>
    </select>
  );

  const detail = <p><Link to="/study" search={{ epd }}>Study this position</Link></p>;

  return (
    <div>
      <h1>Tree</h1>
      <ExplorerWorkspace
        fen={fenForEpd(epd)} evalWhiteCp={null} rows={rows} path={path.map((n) => n.san)}
        onSelectMove={descend} onNavigate={(i) => setPath((p) => p.slice(0, i + 1))} onReset={() => setPath([])}
        controls={controls} detail={detail}
      />
    </div>
  );
}
```

- [ ] **Step 4: Register the `/tree` route in `router.tsx`**

In `web/src/router.tsx`, add the import:

```ts
import { TreePage } from "./routes/tree.js";
```

Add the route (after `studyRoute`):

```ts
const treeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tree", component: TreePage });
```

Add `treeRoute` to the `addChildren` array:

```ts
const routeTree = rootRoute.addChildren([dashboardRoute, leaksRoute, gamesRoute, reviewRoute, studyRoute, treeRoute]);
```

- [ ] **Step 5: Run test + typecheck**

Run: `npm run test -w @coc/web -- src/routes/tree.test.tsx`
Expected: PASS.
Run: `npx tsc -p web/tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/tree.tsx web/src/router.tsx web/src/routes/tree.test.tsx
git commit -m "feat(web): Tree page + /tree route (repertoire navigator)"
```

---

### Task 13: Nav links + leak → Study deep-link

**Files:**
- Modify: `web/src/components/AppShell.tsx` (add Tree + Study nav)
- Modify: `web/src/components/ExplorerLines.tsx` (add a "Study this position" link to the leak detail)
- Test: `web/src/components/ExplorerLines.test.tsx` (update the `Link` mock + assert the study link)

**Interfaces:**
- Consumes: `Link` (TanStack), `toEpd` (already imported in `ExplorerLines.tsx`).
- Produces: a Tree and Study nav entry; a `Link to="/study" search={{ epd }}` in `LeakDetail` where `epd = toEpd(leak.fenBefore)`.

- [ ] **Step 1: Update the `ExplorerLines.test.tsx` `Link` mock and add the assertion (write the failing expectation)**

In `web/src/components/ExplorerLines.test.tsx`, replace the existing `@tanstack/react-router` mock:

```tsx
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params, search }: any) =>
    <a data-testid="occ-link" data-id={params.id} data-ply={search.ply}>{children}</a>,
}));
```

with a version that distinguishes the games links from the new study link:

```tsx
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params, search }: any) =>
    <a data-testid={to === "/study" ? "study-link" : "occ-link"}
       data-id={params?.id} data-ply={search?.ply} data-epd={search?.epd}>{children}</a>,
}));
```

Add an assertion to the existing test (the leak fixture's `fenBefore` is the start position, so its EPD is the start EPD):

```tsx
    expect(screen.getByTestId("study-link"))
      .toHaveAttribute("data-epd", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @coc/web -- src/components/ExplorerLines.test.tsx`
Expected: FAIL — there is no `study-link` yet.

- [ ] **Step 3: Add the Study link to `LeakDetail`**

In `web/src/components/ExplorerLines.tsx`, inside the inner `<div>` (after the closing `)}` of the `occ.length > 0 && (...)` block, before the `</div>`), add:

```tsx
        <p style={{ marginTop: 8 }}>
          <Link to="/study" search={{ epd }}>Study this position</Link>
        </p>
```

(`epd` is already computed at the top of `LeakDetail` as `toEpd(leak.fenBefore)`.)

- [ ] **Step 4: Add the nav links in `AppShell.tsx`**

In `web/src/components/AppShell.tsx`, update the `NAV` array:

```tsx
const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/leaks", label: "Leaks" },
  { to: "/games", label: "Games" },
  { to: "/tree", label: "Tree" },
  { to: "/study", label: "Study" },
];
```

- [ ] **Step 5: Run the full web suite + typecheck + build**

Run: `npm run test -w @coc/web -- src/components/ExplorerLines.test.tsx`
Expected: PASS.
Run: `npm run test -w @coc/web`
Expected: PASS (all files, including `leaks.test.tsx` — its `Link` mock ignores props, so the new link renders harmlessly).
Run: `npx tsc -p web/tsconfig.json --noEmit`
Expected: clean.
Run: `npm run build -w @coc/web`
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/AppShell.tsx web/src/components/ExplorerLines.tsx web/src/components/ExplorerLines.test.tsx
git commit -m "feat(web): Tree/Study nav + leak->Study deep-link"
```

---

### Task 14: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run every workspace suite**

Run: `npm run test -w @coc/shared` — Expected: PASS.
Run: `npm run test -w @coc/server` — Expected: PASS (1 pre-existing engine-integration skip is normal).
Run: `npm run test -w @coc/web` — Expected: PASS.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc -p server/tsconfig.json --noEmit` — Expected: clean.
Run: `npx tsc -p web/tsconfig.json --noEmit` — Expected: clean.
Run: `npm run build -w @coc/web` — Expected: clean build.

- [ ] **Step 3: Manual smoke (optional; needs the Stockfish binary + a prior sync)**

Start backend + frontend (`npm run dev:server`, `npm run dev:web`). Open **Study** → search an opening → step the line by clicking book moves and by dragging a legal move → click **Analyze** on an uncached position. Open **Tree** → toggle color → descend a few of your moves → follow "Study this position". From **Leaks**, expand a row → follow "Study this position". Confirm the eval bar tracks White-POV and that Analyze is rejected (busy) while a sync runs.

- [ ] **Step 4: Commit (if any incidental fixes were needed)**

```bash
git add -A
git commit -m "test: phase-3 study + tree full-suite green"
```

---

## Notes for the implementer

- **Browse is cached reads, except Study's Analyze.** `/explore`, `/tree`, and `/openings` never call the engine; only `/position` does, and it is rejected with **409** while a sync run is active. Mirror the existing `engineVersion()` cache-key convention used by `getGameReview`/`getLeaks` (the cache key is `(epd, depth, engineVersion)`).
- **White-POV everywhere.** All eval numbers shown (`evalWhiteCp` in `ExploreResult`/`PositionAnalysis`, the `EvalBar`) flow through `whitePovCp` (Task 3). Tree carries no engine eval — only your aggregated results + classifications.
- **Tree W/D/L is objective but reads as yours.** Counts are White-wins/draws/Black-wins derived from `(games.result, color)`. Because the Tree is color-scoped, in the White tree "white" = your wins and "black" = your losses (and vice-versa for Black) — so one shared `ExplorerMoveTable` bar serves both views.
- **Study line = a `chess.js` game** seeded from the opening's FEN (`${epd} 0 1`). Book-move clicks and free legal drags both push a SAN onto `moves`; the breadcrumb navigates by slicing it. Promotions auto-queen (rare in the opening; no promotion picker in scope).
- **Pure components, thin pages.** `ExplorerWorkspace`/`ExplorerMoveTable`/`OpeningPicker` are unit-tested without a router; `StudyPage`/`TreePage` wire query + navigation and are tested with a mocked `Chessboard`, api client, and router hooks — exactly the Phase-2 split.
- **Tree → Study deep-link** is implemented as one current-position link in the Tree `detail` slot (not per-row), a small documented deviation from the spec that keeps `ExplorerMoveTable` generic. The leak → Study deep-link is per the spec.

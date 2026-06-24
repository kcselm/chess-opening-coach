# Phase 4 — Drilling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick an opening and rehearse it by playing the line out against a book-driven opponent, grading each move with the app's existing layered "mistake" rule and recording first-try results to recommend what to drill next.

**Architecture:** The drill loop runs entirely in the web app (`chess.js` board state + one `/explore` read per ply, with on-demand `/position` for off-book moves); the server gains only a `drill_attempts` table, a `POST /drill/results` writer, and a `GET /drill/recommended` query. The grading rule is lifted into a pure shared function so the web client and the server classifier compute cp-loss identically. See `docs/superpowers/specs/2026-06-24-phase-4-drilling-design.md`.

**Tech Stack:** TypeScript, Node ≥22, Hono + Drizzle/libSQL, `chess.js`, React + Vite + TanStack Router/Query, chessground, Zod, Vitest + Testing Library.

## Global Constraints

- **Packages:** `@coc/shared`, `@coc/server`, `@coc/web` (npm workspaces). New shared code is re-exported from `shared/src/index.ts`.
- **EPD key:** the first 4 FEN fields (`toEpd(fen)`); a position's full FEN is `` `${epd} 0 1` ``. All position keys are EPDs.
- **Eval sign convention:** Stockfish `score cp` is from the side-to-move's perspective. For a move at the position before it, `cpLoss = max(0, bestCp − playedCp)` with both scores from the *mover's* perspective; the eval *after* a move (opponent to move) is negated to get the mover's-perspective `playedCp`. Mate scores map via `scoreToCp` (`@coc/shared`), which **throws** if both `scoreCp` and `mateIn` are null — never pass it an empty line.
- **Grading defaults (configurable):** `maxCpLoss = 50` (the classifier's inaccuracy threshold); stale window `= 14` days.
- **Test runner:** Vitest. Server tests run in `node`, web tests in `jsdom`. In-memory DB tests create tables inline with `CREATE TABLE` (mirroring existing tests). No live network in the suite; the opponent RNG is seeded.
- **Never commit `server/engine/`** (the Stockfish binary) or `server/data/`.
- **Commits:** conventional-commit style, one per task step where indicated.

---

# Shared package

## Task 1: Seeded RNG + weighted pick (pure)

**Files:**
- Create: `shared/src/rng.ts`
- Test: `shared/src/rng.test.ts`

**Interfaces:**
- Produces: `mulberry32(seed: number): () => number` (deterministic PRNG in [0,1)); `pickWeighted<T>(items: T[], weight: (t: T) => number, rng: () => number): T | null`.

- [ ] **Step 1: Write the failing test**

Create `shared/src/rng.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mulberry32, pickWeighted } from "./rng.js";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42), b = mulberry32(42);
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).toBeGreaterThanOrEqual(0);
    expect(seqA[0]).toBeLessThan(1);
  });
  it("differs across seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("pickWeighted", () => {
  const items = [{ n: "a", w: 1 }, { n: "b", w: 99 }];
  it("returns an item from the list", () => {
    const got = pickWeighted(items, (i) => i.w, mulberry32(7));
    expect(items).toContain(got);
  });
  it("favors heavier weights over many draws", () => {
    const rng = mulberry32(123);
    let bs = 0;
    for (let i = 0; i < 200; i++) if (pickWeighted(items, (i2) => i2.w, rng)!.n === "b") bs++;
    expect(bs).toBeGreaterThan(150); // ~99% expected
  });
  it("returns the first item when all weights are zero, null when empty", () => {
    expect(pickWeighted(items, () => 0, mulberry32(1))).toBe(items[0]);
    expect(pickWeighted([], () => 1, mulberry32(1))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -w @coc/shared -- rng`
Expected: FAIL — `Cannot find module './rng.js'`.

- [ ] **Step 3: Implement `shared/src/rng.ts`**

```ts
/** Small deterministic PRNG (mulberry32). Same seed → same sequence; used so a drill line is
 *  reproducible ("drill again → same line") and tests are deterministic. No Math.random. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one item with probability proportional to `weight`. Falls back to the first item when all
 *  weights are ≤ 0, and null for an empty list. */
export function pickWeighted<T>(items: T[], weight: (t: T) => number, rng: () => number): T | null {
  if (items.length === 0) return null;
  const total = items.reduce((s, it) => s + Math.max(0, weight(it)), 0);
  if (total <= 0) return items[0]!;
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r < 0) return it;
  }
  return items[items.length - 1]!;
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -w @coc/shared -- rng`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/rng.ts shared/src/rng.test.ts
git commit -m "feat(shared): seeded RNG + weighted pick for drill opponent"
```

## Task 2: Shared grading function (pure)

**Files:**
- Create: `shared/src/grade.ts`
- Test: `shared/src/grade.test.ts`

**Interfaces:**
- Consumes: `EngineLine`, `BookMoveStat` (existing in `schemas.ts`), `scoreToCp` (`epd.ts`).
- Produces: `moveCpLoss(bestCp: number, playedCp: number): number`; `gradeDrillMove(input: GradeInput): GradeResult` where
  `GradeInput = { playedUci: string; bookMoves: BookMoveStat[] | null; lines: EngineLine[]; playedEvalCp: number | null; maxCpLoss: number }`
  and `GradeResult = { inBook: boolean; cpLoss: number | null; pass: boolean }`. `DEFAULT_MAX_CP_LOSS = 50`.

- [ ] **Step 1: Write the failing test**

Create `shared/src/grade.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gradeDrillMove, moveCpLoss, DEFAULT_MAX_CP_LOSS } from "./grade.js";
import type { BookMoveStat, EngineLine } from "./schemas.js";

const book: BookMoveStat[] = [
  { san: "e4", uci: "e2e4", count: 100, white: 50, draws: 30, black: 20 },
  { san: "d4", uci: "d2d4", count: 60, white: 30, draws: 20, black: 10 },
];
const lines: EngineLine[] = [
  { rank: 1, scoreCp: 30, mateIn: null, pvUci: ["e2e4"] },
  { rank: 2, scoreCp: 10, mateIn: null, pvUci: ["d2d4"] },
];

describe("moveCpLoss", () => {
  it("is the clamped best-minus-played difference", () => {
    expect(moveCpLoss(30, 10)).toBe(20);
    expect(moveCpLoss(30, 40)).toBe(0); // never negative
  });
});

describe("gradeDrillMove", () => {
  it("passes an in-book best move (cpLoss 0)", () => {
    const r = gradeDrillMove({ playedUci: "e2e4", bookMoves: book, lines, playedEvalCp: null, maxCpLoss: 50 });
    expect(r).toEqual({ inBook: true, cpLoss: 0, pass: true });
  });
  it("fails an in-book move that loses more than the threshold (cpLoss from multiPV)", () => {
    const r = gradeDrillMove({ playedUci: "d2d4", bookMoves: book, lines, playedEvalCp: null, maxCpLoss: 10 });
    expect(r.cpLoss).toBe(20);
    expect(r.pass).toBe(false);
  });
  it("fails an off-book move even when its eval is fine", () => {
    // a2a4 is not in book; its after-eval gives playedEvalCp 20 → cpLoss 10 (≤ threshold) but out of book
    const r = gradeDrillMove({ playedUci: "a2a4", bookMoves: book, lines, playedEvalCp: 20, maxCpLoss: 50 });
    expect(r).toEqual({ inBook: false, cpLoss: 10, pass: false });
  });
  it("uses playedEvalCp when the move is not in the multiPV", () => {
    const r = gradeDrillMove({ playedUci: "g1f3", bookMoves: [...book, { san: "Nf3", uci: "g1f3", count: 40, white: 20, draws: 12, black: 8 }],
      lines, playedEvalCp: -5, maxCpLoss: 50 });
    expect(r.cpLoss).toBe(35); // 30 - (-5)
    expect(r.pass).toBe(true); // in book and within threshold
  });
  it("grades engine-only when book is unknown (null)", () => {
    const r = gradeDrillMove({ playedUci: "d2d4", bookMoves: null, lines, playedEvalCp: null, maxCpLoss: 50 });
    expect(r.inBook).toBe(false);
    expect(r.cpLoss).toBe(20);
    expect(r.pass).toBe(true); // passes on cpLoss alone because book is unknown
  });
  it("returns cpLoss null (ungradable) when no eval is available", () => {
    const r = gradeDrillMove({ playedUci: "h2h4", bookMoves: book, lines: [], playedEvalCp: null, maxCpLoss: 50 });
    expect(r.cpLoss).toBeNull();
    expect(r.pass).toBe(false);
  });
  it("exports a default threshold of 50", () => {
    expect(DEFAULT_MAX_CP_LOSS).toBe(50);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -w @coc/shared -- grade`
Expected: FAIL — `Cannot find module './grade.js'`.

- [ ] **Step 3: Implement `shared/src/grade.ts`**

```ts
import { scoreToCp } from "./epd.js";
import type { EngineLine, BookMoveStat } from "./schemas.js";

export const DEFAULT_MAX_CP_LOSS = 50;

/** cp lost by playing a move scoring `playedCp` when the best scores `bestCp` (both from the
 *  side-to-move's perspective at the position before the move). Never negative. Shared by the
 *  drill grader and the server classifier so cp-loss is computed identically everywhere. */
export function moveCpLoss(bestCp: number, playedCp: number): number {
  return Math.max(0, bestCp - playedCp);
}

export interface GradeInput {
  playedUci: string;
  /** Book moves at the position before the move; `null` means the book is unknown (engine-only grade). */
  bookMoves: BookMoveStat[] | null;
  /** MultiPV lines at the position before the move (from the eval cache). */
  lines: EngineLine[];
  /** Mover's-perspective eval after the move; supply when the move is not in `lines`. */
  playedEvalCp: number | null;
  maxCpLoss: number;
}

export interface GradeResult {
  inBook: boolean;
  cpLoss: number | null;
  pass: boolean;
}

/** The hybrid drill rule (spec §7): a move passes when it is in book AND within `maxCpLoss` of best.
 *  When the book is unknown, it degrades to engine-only (cp-loss alone). Returns `cpLoss: null` when
 *  no eval is available (ungradable) — the caller treats that as "couldn't verify". */
export function gradeDrillMove(input: GradeInput): GradeResult {
  const bookKnown = input.bookMoves !== null;
  const inBook = bookKnown && input.bookMoves!.some((m) => m.uci === input.playedUci);

  const bestLine = input.lines[0];
  const bestCp = bestLine ? scoreToCp(bestLine) : null;
  const matched = input.lines.find((l) => l.pvUci[0] === input.playedUci);
  const playedCp = matched ? scoreToCp(matched) : input.playedEvalCp;

  const cpLoss = bestCp !== null && playedCp !== null ? moveCpLoss(bestCp, playedCp) : null;
  const pass = cpLoss !== null && cpLoss <= input.maxCpLoss && (!bookKnown || inBook);
  return { inBook, cpLoss, pass };
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -w @coc/shared -- grade`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/grade.ts shared/src/grade.test.ts
git commit -m "feat(shared): pure drill grading (in-book AND cp-loss) + shared cpLoss primitive"
```

## Task 3: Drill schemas + barrel exports

**Files:**
- Modify: `shared/src/schemas.ts` (append at end — after `BookSource`/`OpeningListItem`, which these reference)
- Modify: `shared/src/index.ts`

**Interfaces:**
- Produces: Zod schemas + types `DrillAttempt`, `DrillResultsBatch`, `DrillReason`, `DrillRecommendation`.

- [ ] **Step 1: Append the schemas to `shared/src/schemas.ts`**

Add at the very end of the file (it uses `Color`, `BookSource` which are already defined above):

```ts
// One first-try outcome at a position inside a drilled line. `createdAt` is server-stamped, so it
// is not part of this client→server payload.
export const DrillAttempt = z.object({
  epd: z.string(),
  openingEpd: z.string().nullable(),
  openingName: z.string().nullable(),
  color: Color,
  source: BookSource,
  playedUci: z.string(),
  pass: z.boolean(),
  cpLoss: z.number().int().nullable(),
});
export type DrillAttempt = z.infer<typeof DrillAttempt>;

export const DrillResultsBatch = z.object({
  attempts: z.array(DrillAttempt),
});
export type DrillResultsBatch = z.infer<typeof DrillResultsBatch>;

export const DrillReason = z.enum(["leak", "failed", "stale"]);
export type DrillReason = z.infer<typeof DrillReason>;

export const DrillRecommendation = z.object({
  openingEpd: z.string(),
  openingName: z.string(),
  eco: z.string().nullable(),
  reason: DrillReason,
  score: z.number(),
  lastDrilled: z.number().int().nullable(), // epoch seconds; null if never drilled
});
export type DrillRecommendation = z.infer<typeof DrillRecommendation>;
```

- [ ] **Step 2: Add the new modules to the barrel in `shared/src/index.ts`**

Replace the file contents with:

```ts
export * from "./schemas.js";
export * from "./epd.js";
export * from "./grade.js";
export * from "./rng.js";
```

- [ ] **Step 3: Typecheck the shared package**

Run: `npm run build -w @coc/shared`
Expected: PASS (emits `shared/dist`, no type errors).

- [ ] **Step 4: Commit**

```bash
git add shared/src/schemas.ts shared/src/index.ts
git commit -m "feat(shared): drill attempt/recommendation schemas + barrel exports"
```

---

# Server package

## Task 4: Refactor the classifier onto the shared cpLoss primitive (parity)

**Files:**
- Modify: `server/src/classify/classifier.ts`
- Test: `server/src/classify/classifier.test.ts` (add a parity test)

**Interfaces:**
- Consumes: `moveCpLoss` (`@coc/shared`). Public signature of `classifyMove` is unchanged.

- [ ] **Step 1: Add the parity test to `server/src/classify/classifier.test.ts`**

Append this `describe` block to the existing file:

```ts
import { gradeDrillMove, moveCpLoss } from "@coc/shared";

describe("classifier ⇄ shared grade parity", () => {
  it("computes the same cpLoss as moveCpLoss / gradeDrillMove", () => {
    // classifier inputs: bestCpBefore 30, bestCpAfter 10 → evalPlayedCp = -10, cpLoss = 30 - (-10) = 40
    const c = classifyMove({ playedSan: "e6", bestCpBefore: 30, bestCpAfter: 10,
      book: { moves: [{ san: "e6", uci: "e7e6" }] }, thresholds: DEFAULT_THRESHOLDS });
    expect(c.cpLoss).toBe(moveCpLoss(30, -10));

    // the drill grader, given the same position-before lines and the move's after-eval, agrees
    const g = gradeDrillMove({ playedUci: "e7e6",
      bookMoves: [{ san: "e6", uci: "e7e6", count: 1, white: 0, draws: 0, black: 1 }],
      lines: [{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["d2d4"] }],
      playedEvalCp: -10, maxCpLoss: 50 });
    expect(g.cpLoss).toBe(c.cpLoss);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -w @coc/server -- classifier`
Expected: FAIL — `moveCpLoss` is imported but the classifier still inlines the arithmetic; the parity import resolves but the test asserting equality against `moveCpLoss` passes only once the source uses it. (If it already passes by coincidence, Step 3 still locks the shared dependency in.)

- [ ] **Step 3: Use the shared primitive in `server/src/classify/classifier.ts`**

Add the import at the top:

```ts
import { moveCpLoss } from "@coc/shared";
```

Replace the cpLoss line inside `classifyMove`:

```ts
  const evalPlayedCp = -input.bestCpAfter;
  const cpLoss = moveCpLoss(input.bestCpBefore, evalPlayedCp);
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -w @coc/server -- classifier`
Expected: PASS (existing classifier tests + the new parity test).

- [ ] **Step 5: Commit**

```bash
git add server/src/classify/classifier.ts server/src/classify/classifier.test.ts
git commit -m "refactor(server): classifier uses shared moveCpLoss (drill/leak cp-loss parity)"
```

## Task 5: `drill_attempts` table + migration

**Files:**
- Modify: `server/src/db/schema.ts`
- Generate: `server/drizzle/0001_*.sql` (filename auto-assigned by drizzle-kit)

**Interfaces:**
- Produces: `schema.drillAttempts` Drizzle table (columns: `id, epd, openingEpd, openingName, color, source, playedUci, pass(boolean), cpLoss, createdAt`).

- [ ] **Step 1: Add the table to `server/src/db/schema.ts`**

Append after the `openings` table:

```ts
export const drillAttempts = sqliteTable(
  "drill_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    epd: text("epd").notNull(),               // position the user was asked to move in
    openingEpd: text("opening_epd"),          // the opening the drill started from
    openingName: text("opening_name"),
    color: text("color").notNull(),           // which side the user drilled
    source: text("source").notNull(),         // masters | rating
    playedUci: text("played_uci").notNull(),  // the FIRST-TRY move
    pass: integer("pass", { mode: "boolean" }).notNull(),
    cpLoss: integer("cp_loss"),               // null when unverifiable
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({ byEpd: index("drill_attempts_epd_idx").on(t.epd) })
);
```

- [ ] **Step 2: Generate the migration SQL**

Run: `npm run db:generate -w @coc/server`
Expected: a new file `server/drizzle/0001_*.sql` containing `CREATE TABLE drill_attempts ...` and the index.

- [ ] **Step 3: Apply it to the local DB**

Run: `npm run db:migrate -w @coc/server`
Expected: `migrations applied` and the `drill_attempts` table exists in `server/data/app.db`.

- [ ] **Step 4: Commit**

```bash
git add server/src/db/schema.ts server/drizzle
git commit -m "feat(server): drill_attempts table + migration"
```

## Task 6: Results store (persist attempts)

**Files:**
- Create: `server/src/drill/resultsStore.ts`
- Test: `server/src/drill/resultsStore.test.ts`

**Interfaces:**
- Consumes: `DrillAttempt` (`@coc/shared`), `schema.drillAttempts`.
- Produces: `saveDrillResults(db, attempts: DrillAttempt[], now?: () => number): Promise<{ saved: number }>`.

- [ ] **Step 1: Write the failing test**

Create `server/src/drill/resultsStore.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { saveDrillResults } from "./resultsStore.js";
import type { DrillAttempt } from "@coc/shared";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE drill_attempts (id integer primary key autoincrement, epd text,
    opening_epd text, opening_name text, color text, source text, played_uci text,
    pass integer, cp_loss integer, created_at integer);`);
  return drizzle(c, { schema });
}

const attempt = (over: Partial<DrillAttempt>): DrillAttempt => ({
  epd: "E w - -", openingEpd: "R w - -", openingName: "Caro-Kann", color: "black",
  source: "rating", playedUci: "e7e6", pass: true, cpLoss: 0, ...over,
});

describe("saveDrillResults", () => {
  it("inserts each attempt with the stamped timestamp", async () => {
    const db = await memDb();
    const res = await saveDrillResults(db, [attempt({}), attempt({ playedUci: "c8g4", pass: false, cpLoss: 80 })], () => 1700);
    expect(res.saved).toBe(2);
    const rows = await db.select().from(schema.drillAttempts);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.createdAt).toBe(1700);
    const fail = (await db.select().from(schema.drillAttempts).where(eq(schema.drillAttempts.pass, false)))[0];
    expect(fail!.cpLoss).toBe(80);
  });

  it("is a no-op for an empty batch", async () => {
    const db = await memDb();
    expect(await saveDrillResults(db, [])).toEqual({ saved: 0 });
    expect(await db.select().from(schema.drillAttempts)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -w @coc/server -- resultsStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/drill/resultsStore.ts`**

```ts
import type { DrillAttempt } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";

/** Append first-try drill outcomes, all stamped with one timestamp. Append-only: replaying a line
 *  later just adds rows. Returns how many were written. */
export async function saveDrillResults(
  db: Db, attempts: DrillAttempt[], now: () => number = () => Math.floor(Date.now() / 1000)
): Promise<{ saved: number }> {
  if (attempts.length === 0) return { saved: 0 };
  const createdAt = now();
  await db.insert(schema.drillAttempts).values(
    attempts.map((a) => ({
      epd: a.epd, openingEpd: a.openingEpd, openingName: a.openingName, color: a.color,
      source: a.source, playedUci: a.playedUci, pass: a.pass, cpLoss: a.cpLoss, createdAt,
    }))
  );
  return { saved: attempts.length };
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -w @coc/server -- resultsStore`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/drill/resultsStore.ts server/src/drill/resultsStore.test.ts
git commit -m "feat(server): drill results store (append first-try attempts)"
```

## Task 7: Recommended-to-drill query

**Files:**
- Create: `server/src/drill/recommendedQuery.ts`
- Test: `server/src/drill/recommendedQuery.test.ts`

**Interfaces:**
- Consumes: `Leak`, `DrillRecommendation`, `DrillReason`, `toEpd` (`@coc/shared`); `schema.drillAttempts`, `schema.openings`.
- Produces: `getDrillRecommendations(db, leaks: Leak[], opts: { staleDays: number; now: number; limit: number }): Promise<DrillRecommendation[]>`.

The query merges three sources, deduped by opening EPD with precedence **leak > failed > stale**: leaks (recommend drilling from the leak position itself), openings with an unresolved first-try failure, and openings not drilled within `staleDays`.

- [ ] **Step 1: Write the failing test**

Create `server/src/drill/recommendedQuery.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getDrillRecommendations } from "./recommendedQuery.js";
import type { Leak } from "@coc/shared";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE drill_attempts (id integer primary key autoincrement, epd text,
    opening_epd text, opening_name text, color text, source text, played_uci text,
    pass integer, cp_loss integer, created_at integer);`);
  await c.execute(`CREATE TABLE openings (epd text primary key, eco text, name text);`);
  return drizzle(c, { schema });
}

const leak = (over: Partial<Leak>): Leak => ({
  openingName: "Sicilian", eco: "B20", fenBefore: "LEAK w - - 0 1", lineSan: "", yourMoveSan: "d4",
  betterMoveSan: "Nf3", occurrences: 3, avgCpLoss: 120, scorePct: 33, bookStatus: "novelty", ...over,
});

describe("getDrillRecommendations", () => {
  it("ranks leak > failed > stale and dedups by opening", async () => {
    const db = await memDb();
    await db.insert(schema.openings).values({ epd: "FAILROOT w - -", eco: "C10", name: "French" });
    const NOW = 1_000_000;
    const day = 86400;
    // an opening with an unresolved failure (latest attempt at its epd is a fail)
    await db.insert(schema.drillAttempts).values([
      { epd: "p1 w - -", openingEpd: "FAILROOT w - -", openingName: "French", color: "white",
        source: "rating", playedUci: "x", pass: false, cpLoss: 90, createdAt: NOW - day },
    ]);
    // a stale opening (drilled long ago, no failures)
    await db.insert(schema.drillAttempts).values([
      { epd: "p2 w - -", openingEpd: "STALEROOT w - -", openingName: "London", color: "white",
        source: "rating", playedUci: "y", pass: true, cpLoss: 0, createdAt: NOW - 40 * day },
    ]);

    const recs = await getDrillRecommendations(db, [leak({})], { staleDays: 14, now: NOW, limit: 10 });

    expect(recs.map((r) => r.reason)).toEqual(["leak", "failed", "stale"]);
    expect(recs[0]!.openingEpd).toBe("LEAK w - -");         // toEpd(fenBefore)
    expect(recs[0]!.score).toBe(360);                       // 3 × 120
    expect(recs[1]!).toMatchObject({ openingEpd: "FAILROOT w - -", eco: "C10", openingName: "French" });
    expect(recs[2]!.openingEpd).toBe("STALEROOT w - -");
  });

  it("omits recently-drilled openings with no open failures", async () => {
    const db = await memDb();
    const NOW = 1_000_000;
    await db.insert(schema.drillAttempts).values([
      { epd: "p w - -", openingEpd: "FRESH w - -", openingName: "Italian", color: "white",
        source: "rating", playedUci: "z", pass: true, cpLoss: 0, createdAt: NOW - 3 * 86400 },
    ]);
    const recs = await getDrillRecommendations(db, [], { staleDays: 14, now: NOW, limit: 10 });
    expect(recs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -w @coc/server -- recommendedQuery`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/drill/recommendedQuery.ts`**

```ts
import { asc } from "drizzle-orm";
import { toEpd, type Leak, type DrillRecommendation, type DrillReason } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";

export interface RecommendOpts { staleDays: number; now: number; limit: number }

const REASON_RANK: Record<DrillReason, number> = { leak: 0, failed: 1, stale: 2 };

/** Ranked "what to drill" list: leaks (drill from the leak position), openings with an unresolved
 *  first-try failure, and openings gone stale. Deduped by opening EPD, precedence leak > failed > stale. */
export async function getDrillRecommendations(
  db: Db, leaks: Leak[], opts: RecommendOpts
): Promise<DrillRecommendation[]> {
  const byEpd = new Map<string, DrillRecommendation>();

  // 1. Leaks — highest precedence; drill starts at the leak position itself.
  for (const lk of leaks) {
    const epd = toEpd(lk.fenBefore);
    if (!byEpd.has(epd)) {
      byEpd.set(epd, {
        openingEpd: epd, openingName: lk.openingName, eco: lk.eco,
        reason: "leak", score: lk.occurrences * lk.avgCpLoss, lastDrilled: null,
      });
    }
  }

  // 2. Aggregate past attempts by the opening the user drilled (rows in chronological id order, so
  //    the last write per (openingEpd, epd) is the most recent first-try outcome).
  const rows = await db.select().from(schema.drillAttempts).orderBy(asc(schema.drillAttempts.id));
  interface Agg { name: string | null; last: number; latestPassByEpd: Map<string, boolean> }
  const aggs = new Map<string, Agg>();
  for (const r of rows) {
    if (!r.openingEpd) continue;
    let a = aggs.get(r.openingEpd);
    if (!a) { a = { name: r.openingName, last: 0, latestPassByEpd: new Map() }; aggs.set(r.openingEpd, a); }
    if (r.createdAt >= a.last) { a.last = r.createdAt; a.name = r.openingName; }
    a.latestPassByEpd.set(r.epd, r.pass);
  }

  const catalog = new Map((await db.select().from(schema.openings)).map((o) => [o.epd, o]));
  const staleCutoff = opts.now - opts.staleDays * 86400;

  for (const [openingEpd, a] of aggs) {
    if (byEpd.has(openingEpd)) continue; // a leak already covers this position
    const failures = [...a.latestPassByEpd.values()].filter((p) => !p).length;
    const cat = catalog.get(openingEpd);
    const base = {
      openingEpd,
      openingName: cat?.name ?? a.name ?? "Unknown opening",
      eco: cat?.eco ?? null,
      lastDrilled: a.last,
    };
    if (failures > 0) {
      byEpd.set(openingEpd, { ...base, reason: "failed", score: failures });
    } else if (a.last < staleCutoff) {
      byEpd.set(openingEpd, { ...base, reason: "stale", score: (opts.now - a.last) / 86400 });
    }
  }

  return [...byEpd.values()]
    .sort((x, y) => REASON_RANK[x.reason] - REASON_RANK[y.reason] || y.score - x.score)
    .slice(0, opts.limit);
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -w @coc/server -- recommendedQuery`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/drill/recommendedQuery.ts server/src/drill/recommendedQuery.test.ts
git commit -m "feat(server): recommended-to-drill query (leaks + failed + stale)"
```

## Task 8: Drill routes + dependency wiring

**Files:**
- Modify: `server/src/routes/app.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/routes/app.drill.test.ts`

**Interfaces:**
- Consumes: `saveDrillResults`, `getDrillRecommendations`, `getLeaks`.
- Produces (HTTP): `POST /drill/results` (body `DrillResultsBatch` → `{ saved }`), `GET /drill/recommended` (→ `DrillRecommendation[]`). Adds `AppDeps.saveDrillResults` and `AppDeps.getDrillRecommendations`.

- [ ] **Step 1: Write the failing route test**

Create `server/src/routes/app.drill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { RunStore } from "../runStore.js";
import type { DrillRecommendation, DrillResultsBatch } from "@coc/shared";

const rec: DrillRecommendation = {
  openingEpd: "R w - -", openingName: "Caro-Kann", eco: "B10", reason: "leak", score: 360, lastDrilled: null,
};

describe("drill routes", () => {
  it("GET /drill/recommended returns the injected list", async () => {
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getDrillRecommendations: async () => [rec] });
    const res = await app.request("/drill/recommended");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([rec]);
  });

  it("POST /drill/results forwards the batch and returns the saved count", async () => {
    let received: DrillResultsBatch | null = null;
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      saveDrillResults: async (b) => { received = b; return { saved: b.attempts.length }; } });
    const body: DrillResultsBatch = { attempts: [{ epd: "E w - -", openingEpd: "R w - -",
      openingName: "Caro-Kann", color: "black", source: "rating", playedUci: "e7e6", pass: true, cpLoss: 0 }] };
    const res = await app.request("/drill/results", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: 1 });
    expect(received).toEqual(body);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -w @coc/server -- app.drill`
Expected: FAIL — the routes/deps don't exist yet.

- [ ] **Step 3: Add the deps and routes in `server/src/routes/app.ts`**

Extend the type import on line 5–6 to include the drill types:

```ts
import { SyncRequest, DrillResultsBatch, type Leak, type GameSummary, type GameReview, type LeakOccurrence,
  type OpeningListItem, type ExploreResult, type PositionAnalysis, type TreeChildren,
  type DrillRecommendation } from "@coc/shared";
```

Add to the `AppDeps` interface:

```ts
  saveDrillResults?: (batch: DrillResultsBatch) => Promise<{ saved: number }>;
  getDrillRecommendations?: () => Promise<DrillRecommendation[]>;
```

Add the two routes to the chain (e.g. after the `/tree` route, before the closing `;`):

```ts
    .post("/drill/results", zValidator("json", DrillResultsBatch), async (c) => {
      const batch = c.req.valid("json");
      return c.json((await deps.saveDrillResults?.(batch)) ?? { saved: 0 });
    })
    .get("/drill/recommended", async (c) => c.json((await deps.getDrillRecommendations?.()) ?? []))
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -w @coc/server -- app.drill`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the real implementations in `server/src/index.ts`**

Add the imports near the other service imports:

```ts
import { saveDrillResults } from "./drill/resultsStore.js";
import { getDrillRecommendations } from "./drill/recommendedQuery.js";
```

Add to the `createApp({ ... })` deps object (after `getTree`):

```ts
  saveDrillResults: (batch) => saveDrillResults(db, batch.attempts),
  getDrillRecommendations: async () =>
    getDrillRecommendations(
      db,
      await getLeaks(db, { minCpLoss: DEFAULT_THRESHOLDS.mistake, depth: DEPTH, engineVersion: engineVersion(), limit: 50 }),
      { staleDays: 14, now: Math.floor(Date.now() / 1000), limit: 30 }
    ),
```

- [ ] **Step 6: Typecheck the server**

Run: `npm run typecheck -w @coc/server` (if present) or `npx tsc -p server/tsconfig.json --noEmit`
Expected: PASS — no type errors. (Per the project's verification setup, the server is type-checked separately from the Vitest run.)

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/app.ts server/src/index.ts server/src/routes/app.drill.test.ts
git commit -m "feat(server): /drill/results + /drill/recommended routes and wiring"
```

---

# Web package

## Task 9: `useDrill` hook (the drill loop)

**Files:**
- Create: `web/src/hooks/useDrill.ts`
- Test: `web/src/hooks/useDrill.test.ts`

**Interfaces:**
- Consumes: `api` (`../api/client.js`), `gradeDrillMove`, `mulberry32`, `pickWeighted`, `toEpd`, `scoreToCp`, types `Color`, `BookSource`, `BookMoveStat`, `DrillAttempt`, `ExploreResult`, `PositionAnalysis` (`@coc/shared`); `Chess` (`chess.js`).
- Produces: `useDrill(args: UseDrillArgs): DrillApi`. `UseDrillArgs = { rootEpd, color, source, maxCpLoss, openingName, seed?, oppDelayMs? }`. `DrillApi = DrillState & { playMove(orig, dest): Promise<void>; restart(): void }`. See the `DrillState`/`DrillMissed` shapes in Step 3.

- [ ] **Step 1: Write the failing test**

Create `web/src/hooks/useDrill.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ExploreResult, PositionAnalysis } from "@coc/shared";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3";
const AFTER_C5 = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6";

const exp = (epd: string, book: ExploreResult["bookMoves"], lines: ExploreResult["lines"]): ExploreResult =>
  ({ epd, source: "rating", total: book.reduce((s, b) => s + b.count, 0), bookMoves: book, evalWhiteCp: 20, lines });

const fixtures: Record<string, ExploreResult> = {
  [START]: exp(START, [{ san: "e4", uci: "e2e4", count: 100, white: 50, draws: 30, black: 20 }],
    [{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["e2e4"] }]),
  [AFTER_E4]: exp(AFTER_E4, [{ san: "c5", uci: "c7c5", count: 100, white: 40, draws: 30, black: 30 }],
    [{ rank: 1, scoreCp: -20, mateIn: null, pvUci: ["c7c5"] }]),
  [AFTER_C5]: exp(AFTER_C5, [], []), // out of book → line ends
};

const exploreGet = vi.fn(async ({ query }: { query: { epd: string } }) =>
  ({ status: 200, json: async () => fixtures[query.epd] ?? exp(query.epd, [], []) }));
const positionGet = vi.fn(async ({ query }: { query: { fen: string } }): Promise<{ status: number; json: () => Promise<PositionAnalysis> }> =>
  ({ status: 200, json: async () => ({ epd: "x", evalWhiteCp: -20, scoreCp: 20, mateIn: null,
    lines: [{ rank: 1, scoreCp: 20, mateIn: null, pvUci: ["a7a6"] }], depth: 18, engineVersion: "v" }) }));
const resultsPost = vi.fn(async () => ({ ok: true, json: async () => ({ saved: 1 }) }));

vi.mock("../api/client.js", () => ({
  api: {
    explore: { $get: (a: unknown) => exploreGet(a as { query: { epd: string } }) },
    position: { $get: (a: unknown) => positionGet(a as { query: { fen: string } }) },
    drill: { results: { $post: (a: unknown) => resultsPost(a as unknown) }, recommended: { $get: vi.fn() } },
  },
}));

async function mountDrill(over: Partial<Parameters<typeof import("./useDrill.js")["useDrill"]>[0]> = {}) {
  const { useDrill } = await import("./useDrill.js");
  return renderHook(() => useDrill({ rootEpd: START, color: "white", source: "rating",
    maxCpLoss: 50, openingName: "King's Pawn", seed: 1, oppDelayMs: 0, ...over }));
}

describe("useDrill", () => {
  beforeEach(() => vi.clearAllMocks());

  it("plays a passing line to its out-of-book end and posts results", async () => {
    const { result } = await mountDrill();
    await waitFor(() => expect(result.current.status).toBe("playing"));
    expect(result.current.movableColor).toBe("white");

    await act(async () => { await result.current.playMove("e2", "e4"); });
    await waitFor(() => expect(result.current.status).toBe("done"));

    expect(result.current.correct).toBe(1);
    expect(result.current.total).toBe(1);
    expect(resultsPost).toHaveBeenCalledTimes(1);
    const posted = resultsPost.mock.calls[0]![0] as { json: { attempts: unknown[] } };
    expect(posted.json.attempts).toHaveLength(1);
  });

  it("flags an off-book move, records the first-try miss, and waits for a retry", async () => {
    const { result } = await mountDrill();
    await waitFor(() => expect(result.current.status).toBe("playing"));

    await act(async () => { await result.current.playMove("a2", "a4"); }); // not in book
    expect(result.current.status).toBe("playing");           // not advanced
    expect(result.current.movableColor).toBe("white");       // board still the user's
    expect(result.current.feedback?.betterSans).toContain("e4");
    expect(result.current.missed.some((m) => m.epd === START)).toBe(true);

    // retry with the book move → advances
    await act(async () => { await result.current.playMove("e2", "e4"); });
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.total).toBe(1);     // only the first-try (failed) attempt was recorded
    expect(result.current.correct).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -w @coc/web -- useDrill`
Expected: FAIL — `Cannot find module './useDrill.js'`.

- [ ] **Step 3: Implement `web/src/hooks/useDrill.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  gradeDrillMove, mulberry32, pickWeighted, toEpd, scoreToCp,
  type Color, type BookSource, type BookMoveStat, type DrillAttempt,
  type ExploreResult, type PositionAnalysis,
} from "@coc/shared";
import { api } from "../api/client.js";

const fenForEpd = (epd: string) => `${epd} 0 1`;
const DRILL_MAX_PLIES = 24;   // plies from the root before the line auto-completes
const OPP_DELAY_MS = 350;     // pause before the opponent replies, so it reads as a game
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface DrillMissed { epd: string; betterSan: string | null }

export interface DrillState {
  status: "loading" | "playing" | "done";
  fen: string;
  movableColor: Color | undefined;            // set only on the user's turn
  dests: Map<string, string[]>;
  bookMoves: BookMoveStat[];
  evalWhiteCp: number | null;
  lineSan: string[];
  feedback: { betterSans: string[] } | null;  // shown on a miss
  correct: number;
  total: number;
  missed: DrillMissed[];
}

export interface UseDrillArgs {
  rootEpd: string; color: Color; source: BookSource; maxCpLoss: number;
  openingName: string | null; seed?: number; oppDelayMs?: number;
}

export type DrillApi = DrillState & {
  playMove: (orig: string, dest: string) => Promise<void>;
  restart: () => void;
};

function legalDests(game: Chess): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const mv of game.moves({ verbose: true })) {
    const arr = m.get(mv.from) ?? []; arr.push(mv.to); m.set(mv.from, arr);
  }
  return m;
}

const initialState: DrillState = {
  status: "loading", fen: "", movableColor: undefined, dests: new Map(), bookMoves: [],
  evalWhiteCp: null, lineSan: [], feedback: null, correct: 0, total: 0, missed: [],
};

export function useDrill(args: UseDrillArgs): DrillApi {
  const [state, setState] = useState<DrillState>(initialState);
  const [restartKey, setRestartKey] = useState(0);

  const gameRef = useRef<Chess | null>(null);
  const rngRef = useRef<() => number>(() => 0);
  const startPliesRef = useRef(0);
  const recordedRef = useRef<Set<string>>(new Set());   // epds with a recorded first try
  const attemptsRef = useRef<DrillAttempt[]>([]);
  const missedRef = useRef<DrillMissed[]>([]);
  const curRef = useRef<{ bookMoves: BookMoveStat[]; lines: ExploreResult["lines"] }>({ bookMoves: [], lines: [] });
  const genRef = useRef(0); // bumped each (re)start; stale async chains bail (StrictMode/restart safe)

  const finish = useCallback(async (gen: number) => {
    if (genRef.current !== gen) return;
    setState((s) => ({ ...s, status: "done", movableColor: undefined, dests: new Map(), feedback: null }));
    if (attemptsRef.current.length) {
      try { await api.drill.results.$post({ json: { attempts: attemptsRef.current } }); } catch { /* surfaced by the page */ }
    }
  }, []);

  const advance = useCallback(async (gen: number) => {
    const game = gameRef.current!;
    if (game.history().length - startPliesRef.current >= DRILL_MAX_PLIES) return finish(gen);

    const epd = toEpd(game.fen());
    let explore: ExploreResult | null = null;
    try {
      const res = await api.explore.$get({ query: { epd, source: args.source } });
      if (res.status === 200) explore = (await res.json()) as ExploreResult;
    } catch { explore = null; }
    if (genRef.current !== gen) return; // a restart/unmount superseded this chain

    const bookMoves = explore?.bookMoves ?? [];
    curRef.current = { bookMoves, lines: explore?.lines ?? [] };
    if (bookMoves.length === 0) return finish(gen); // out of book → end

    const sideToMove: Color = game.turn() === "w" ? "white" : "black";
    const mine = sideToMove === args.color;
    setState((s) => ({
      ...s, status: "playing", fen: game.fen(), bookMoves, evalWhiteCp: explore?.evalWhiteCp ?? null,
      lineSan: game.history(), feedback: null,
      movableColor: mine ? args.color : undefined, dests: mine ? legalDests(game) : new Map(),
    }));

    if (!mine) {
      const pick = pickWeighted(bookMoves, (m) => m.count, rngRef.current);
      if (!pick) return finish(gen);
      await sleep(args.oppDelayMs ?? OPP_DELAY_MS);
      if (genRef.current !== gen) return;
      try { game.move(pick.san); } catch { return finish(gen); }
      await advance(gen);
    }
  }, [args.source, args.color, args.oppDelayMs, finish]);

  // (re)start the drill on mount and on restart()
  useEffect(() => {
    const gen = ++genRef.current;
    const game = new Chess(fenForEpd(args.rootEpd));
    gameRef.current = game;
    rngRef.current = mulberry32((args.seed ?? (Date.now() >>> 0)) + restartKey);
    startPliesRef.current = game.history().length;
    recordedRef.current = new Set();
    attemptsRef.current = [];
    missedRef.current = [];
    setState({ ...initialState });
    void advance(gen);
    return () => { genRef.current++; }; // invalidate this run (StrictMode remount / restart)
  }, [args.rootEpd, args.color, args.source, restartKey, advance]);

  const playMove = useCallback(async (orig: string, dest: string) => {
    const game = gameRef.current;
    if (!game) return;
    const gen = genRef.current;
    const probe = new Chess(game.fen());
    let mv;
    try { mv = probe.move({ from: orig, to: dest, promotion: "q" }); } catch { return; }
    if (!mv) return;
    const uci = mv.from + mv.to + (mv.promotion ?? "");
    const epd = toEpd(game.fen());
    const cur = curRef.current;

    // need an after-eval only when the move isn't already in the multiPV
    let playedEvalCp: number | null = null;
    if (!cur.lines.some((l) => l.pvUci[0] === uci)) {
      try {
        const res = await api.position.$get({ query: { fen: probe.fen() } });
        if (res.status === 200) {
          const pa = (await res.json()) as PositionAnalysis;
          const after = pa.lines[0] ?? null;
          playedEvalCp = after ? -scoreToCp(after) : pa.scoreCp !== null ? -pa.scoreCp : null;
        }
      } catch { /* leave null → ungradable */ }
    }
    if (genRef.current !== gen) return; // a restart superseded this move

    const grade = gradeDrillMove({ playedUci: uci, bookMoves: cur.bookMoves, lines: cur.lines, playedEvalCp, maxCpLoss: args.maxCpLoss });

    // ungradable (no eval available) → accept and continue without recording
    if (grade.cpLoss === null) { game.move(mv.san); await advance(gen); return; }

    const firstTry = !recordedRef.current.has(epd);
    if (firstTry) {
      recordedRef.current.add(epd);
      attemptsRef.current.push({ epd, openingEpd: args.rootEpd, openingName: args.openingName,
        color: args.color, source: args.source, playedUci: uci, pass: grade.pass, cpLoss: grade.cpLoss });
    }

    if (grade.pass) { game.move(mv.san); await advance(gen); return; }

    // miss: keep the board on the user, show the book answers as the hint
    if (firstTry) missedRef.current = [...missedRef.current, { epd, betterSan: cur.bookMoves[0]?.san ?? null }];
    setState((s) => ({
      ...s, feedback: { betterSans: cur.bookMoves.slice(0, 3).map((b) => b.san) },
      correct: attemptsRef.current.filter((a) => a.pass).length, total: attemptsRef.current.length,
      missed: missedRef.current,
    }));
  }, [args.maxCpLoss, args.rootEpd, args.openingName, args.color, args.source, advance]);

  // keep accuracy counters fresh after passing moves too
  useEffect(() => {
    setState((s) => ({ ...s, correct: attemptsRef.current.filter((a) => a.pass).length, total: attemptsRef.current.length }));
  }, [state.fen, state.status]);

  const restart = useCallback(() => setRestartKey((k) => k + 1), []);
  return { ...state, playMove, restart };
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -w @coc/web -- useDrill`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useDrill.ts web/src/hooks/useDrill.test.ts
git commit -m "feat(web): useDrill loop (explore-per-ply, shared grade, retry-until-correct)"
```

## Task 10: `DrillWorkspace` component + board orientation

**Files:**
- Modify: `web/src/components/Chessboard.tsx` (add optional `orientation`)
- Create: `web/src/components/DrillWorkspace.tsx`
- Test: `web/src/components/DrillWorkspace.test.tsx`

**Interfaces:**
- Consumes: `DrillState`, `DrillApi` shapes (from `useDrill.js`); `Chessboard`, `EvalBar`.
- Produces: `<DrillWorkspace drill={DrillApi} color={Color} onAgain={() => void} onBack={() => void} />`. `Chessboard` gains `orientation?: "white" | "black"` (default `"white"`).

- [ ] **Step 1: Add `orientation` to `web/src/components/Chessboard.tsx`**

Add `orientation` to the props and pass it to Chessground (both the init and the `set`). The signature becomes:

```ts
export function Chessboard({ fen, arrows = [], size = 320, onMove, dests, movableColor, orientation = "white" }: {
  fen: string; arrows?: BoardArrow[]; size?: number;
  onMove?: (orig: string, dest: string) => void;
  dests?: Map<string, string[]>; movableColor?: "white" | "black";
  orientation?: "white" | "black";
}) {
```

In the init effect:

```ts
    api.current = Chessground(el.current, { fen, viewOnly: !onMove, coordinates: false, orientation });
```

In the update effect, add `orientation` to the `set` object and to the dependency array (full effect shown):

```ts
  useEffect(() => {
    api.current?.set({
      fen,
      orientation,
      viewOnly: !onMove,
      movable: onMove
        ? { free: false, color: movableColor, dests: dests as unknown as Map<Key, Key[]>,
            events: { after: (orig, dest) => onMove(orig as string, dest as string) } }
        : undefined,
      drawable: { autoShapes: arrows.map((a) => ({ orig: a.orig as Key, dest: a.dest as Key, brush: a.brush ?? "green" })) },
    });
  }, [fen, arrows, onMove, dests, movableColor, orientation]);
```

- [ ] **Step 2: Write the failing test**

Create `web/src/components/DrillWorkspace.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DrillApi } from "../hooks/useDrill.js";

vi.mock("./Chessboard.js", () => ({
  Chessboard: ({ fen, orientation }: { fen: string; orientation?: string }) =>
    <div data-testid="board" data-fen={fen} data-orientation={orientation} />,
}));
vi.mock("./EvalBar.js", () => ({ EvalBar: () => <div data-testid="evalbar" /> }));

import { DrillWorkspace } from "./DrillWorkspace.js";

const base: DrillApi = {
  status: "playing", fen: "8/8/8/8/8/8/8/8 b - -", movableColor: "black", dests: new Map(),
  bookMoves: [{ san: "e6", uci: "e7e6", count: 61, white: 30, draws: 20, black: 11 },
    { san: "Nf6", uci: "g8f6", count: 22, white: 10, draws: 7, black: 5 }],
  evalWhiteCp: 15, lineSan: ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4"], feedback: null,
  correct: 3, total: 4, missed: [], playMove: vi.fn(async () => {}), restart: vi.fn(),
};

describe("DrillWorkspace", () => {
  it("orients the board to the drilled color and shows accuracy + theory", () => {
    render(<DrillWorkspace drill={base} color="black" onAgain={() => {}} onBack={() => {}} />);
    expect(screen.getByTestId("board").getAttribute("data-orientation")).toBe("black");
    expect(screen.getByText("3/4")).toBeInTheDocument();
    expect(screen.getByText("e6")).toBeInTheDocument(); // book theory stays visible
  });

  it("shows the better-move hint on a miss", () => {
    render(<DrillWorkspace drill={{ ...base, feedback: { betterSans: ["e6", "Nf6"] } }} color="black" onAgain={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/Better:/)).toBeInTheDocument();
    expect(screen.getByText(/e6/)).toBeInTheDocument();
  });

  it("shows the completion summary with Drill again / Back when done", () => {
    const onAgain = vi.fn(), onBack = vi.fn();
    render(<DrillWorkspace drill={{ ...base, status: "done", movableColor: undefined,
      missed: [{ epd: "X w - -", betterSan: "e6" }] }} color="black" onAgain={onAgain} onBack={onBack} />);
    fireEvent.click(screen.getByText("Drill again"));
    fireEvent.click(screen.getByText("Back to recommendations"));
    expect(onAgain).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test, expect failure**

Run: `npm run test -w @coc/web -- DrillWorkspace`
Expected: FAIL — `Cannot find module './DrillWorkspace.js'`.

- [ ] **Step 4: Implement `web/src/components/DrillWorkspace.tsx`**

```tsx
import { Link } from "@tanstack/react-router";
import type { Color } from "@coc/shared";
import type { DrillApi } from "../hooks/useDrill.js";
import { Chessboard } from "./Chessboard.js";
import { EvalBar } from "./EvalBar.js";

export function DrillWorkspace({ drill, color, onAgain, onBack }: {
  drill: DrillApi; color: Color; onAgain: () => void; onBack: () => void;
}) {
  const done = drill.status === "done";
  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <EvalBar cp={drill.evalWhiteCp} />
        <Chessboard
          fen={drill.fen} orientation={color} movableColor={drill.movableColor} dests={drill.dests}
          onMove={drill.movableColor ? (o, d) => void drill.playMove(o, d) : undefined}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 260 }}>
        {/* top: live feedback + accuracy */}
        <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
          <span>{done ? "Line complete" : drill.movableColor ? "Your move" : "Opponent…"}</span>
          <b data-testid="accuracy">{drill.correct}/{drill.total}</b>
        </div>

        {drill.feedback && !done && (
          <div style={{ padding: 8, borderLeft: "3px solid #e5534b", background: "#fdeceb" }}>
            <b>Not in book.</b> Better: {drill.feedback.betterSans.join(" / ")}
          </div>
        )}

        {done && (
          <div style={{ padding: 8, border: "1px solid #ddd", borderRadius: 6 }}>
            <div>First-try accuracy: <b>{drill.correct}/{drill.total}</b></div>
            {drill.missed.length > 0 && (
              <ul style={{ paddingLeft: 16 }}>
                {drill.missed.map((m) => (
                  <li key={m.epd}>
                    <Link to="/study" search={{ epd: m.epd }}>{m.betterSan ?? "review"} — study this</Link>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={onAgain}>Drill again</button>
              <button onClick={onBack}>Back to recommendations</button>
            </div>
          </div>
        )}

        {/* bottom: book theory stays visible while drilling (learn-as-you-go) */}
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888" }}>Theory from here</div>
          <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {drill.bookMoves.map((b) => {
                const pct = drill.bookMoves.reduce((s, x) => s + x.count, 0);
                return (
                  <tr key={b.uci}>
                    <td style={{ padding: "2px 8px 2px 0" }}>{b.san}</td>
                    <td style={{ padding: "2px 0", color: "#888" }}>{pct ? Math.round((b.count / pct) * 100) : 0}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div data-testid="line" style={{ fontSize: 12, color: "#888", maxWidth: 280 }}>{drill.lineSan.join(" ")}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test, expect pass**

Run: `npm run test -w @coc/web -- DrillWorkspace`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Chessboard.tsx web/src/components/DrillWorkspace.tsx web/src/components/DrillWorkspace.test.tsx
git commit -m "feat(web): DrillWorkspace (split feedback/theory panel) + board orientation"
```

## Task 11: Drill route + nav + router

**Files:**
- Create: `web/src/routes/drill.tsx`
- Modify: `web/src/components/AppShell.tsx`
- Modify: `web/src/router.tsx`
- Test: `web/src/routes/drill.test.tsx`

**Interfaces:**
- Consumes: `api`, `OpeningPicker`, `DrillWorkspace`, `useDrill`, `DEFAULT_MAX_CP_LOSS`, types `DrillRecommendation`, `Color`, `BookSource`.
- Produces: `DrillPage` component; `/drill` route with `validateSearch` for `{ epd?, color?, source? }`; a "Drill" nav entry.

- [ ] **Step 1: Write the failing test**

Create `web/src/routes/drill.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DrillRecommendation } from "@coc/shared";

const recs: DrillRecommendation[] = [
  { openingEpd: "R w - -", openingName: "Caro-Kann", eco: "B10", reason: "leak", score: 360, lastDrilled: null },
];

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
  Link: ({ children }: { children: unknown }) => <span>{children}</span>,
}));
vi.mock("../api/client.js", () => ({
  api: { drill: { recommended: { $get: vi.fn(async () => ({ json: async () => recs })) } },
    openings: { $get: vi.fn(async () => ({ json: async () => [] })) } },
}));
// stub the loop so the route test is isolated from board/engine behavior
vi.mock("../hooks/useDrill.js", () => ({
  useDrill: () => ({ status: "playing", fen: "8/8/8/8/8/8/8/8 w - -", movableColor: "white",
    dests: new Map(), bookMoves: [], evalWhiteCp: 0, lineSan: [], feedback: null,
    correct: 0, total: 0, missed: [], playMove: vi.fn(), restart: vi.fn() }),
}));
vi.mock("../components/DrillWorkspace.js", () => ({ DrillWorkspace: () => <div data-testid="workspace" /> }));

async function renderPage() {
  const { DrillPage } = await import("./drill.js");
  render(<QueryClientProvider client={new QueryClient()}><DrillPage /></QueryClientProvider>);
}

describe("DrillPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("lists recommendations and starts a drill when one is clicked", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText(/Caro-Kann/)).toBeInTheDocument());
    expect(screen.getByText("leak")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Caro-Kann/));
    await waitFor(() => expect(screen.getByTestId("workspace")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -w @coc/web -- drill`
Expected: FAIL — `Cannot find module './drill.js'`.

- [ ] **Step 3: Implement `web/src/routes/drill.tsx`**

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { DEFAULT_MAX_CP_LOSS, type DrillRecommendation, type Color, type BookSource } from "@coc/shared";
import { api } from "../api/client.js";
import { OpeningPicker } from "../components/OpeningPicker.js";
import { DrillWorkspace } from "../components/DrillWorkspace.js";
import { useDrill } from "../hooks/useDrill.js";

interface Selection { epd: string; name: string | null }

export function DrillPage() {
  const search = useSearch({ from: "/drill" });
  const [sel, setSel] = useState<Selection | null>(search.epd ? { epd: search.epd, name: null } : null);
  const [color, setColor] = useState<Color>(search.color ?? "white");
  const [source, setSource] = useState<BookSource>(search.source ?? "rating");
  const [seedKey, setSeedKey] = useState(0); // bump to remount the drill for a fresh line

  if (sel) {
    return <DrillRun key={seedKey} epd={sel.epd} name={sel.name} color={color} source={source}
      onAgain={() => setSeedKey((k) => k + 1)} onBack={() => setSel(null)} />;
  }

  return (
    <div>
      <h1>Drill</h1>
      <div style={{ display: "flex", gap: 12, margin: "8px 0" }}>
        <label>color{" "}
          <select aria-label="color" value={color} onChange={(e) => setColor(e.target.value as Color)}>
            <option value="white">white</option><option value="black">black</option>
          </select>
        </label>
        <label>book{" "}
          <select aria-label="book source" value={source} onChange={(e) => setSource(e.target.value as BookSource)}>
            <option value="rating">my rating</option><option value="masters">masters</option>
          </select>
        </label>
      </div>

      <Recommended onPick={(r) => setSel({ epd: r.openingEpd, name: r.openingName })} />

      <h3 style={{ marginTop: 16 }}>Or pick any opening</h3>
      <OpeningPicker onPick={(o) => setSel({ epd: o.epd, name: o.name })} />
    </div>
  );
}

function Recommended({ onPick }: { onPick: (r: DrillRecommendation) => void }) {
  const { data: recs = [] } = useQuery({
    queryKey: ["drill-recommended"],
    queryFn: async () => (await (await api.drill.recommended.$get()).json()) as DrillRecommendation[],
  });
  if (recs.length === 0) return <p>No recommendations yet — sync some games, or pick an opening below.</p>;
  return (
    <ul style={{ listStyle: "none", padding: 0, maxWidth: 420 }}>
      {recs.map((r) => (
        <li key={r.openingEpd} style={{ margin: "4px 0" }}>
          <button onClick={() => onPick(r)} style={{ cursor: "pointer", textAlign: "left", width: "100%" }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", background: "#eee", padding: "1px 6px", borderRadius: 4, marginRight: 8 }}>{r.reason}</span>
            <b>{r.eco ?? ""}</b> {r.openingName}
          </button>
        </li>
      ))}
    </ul>
  );
}

function DrillRun({ epd, name, color, source, onAgain, onBack }: {
  epd: string; name: string | null; color: Color; source: BookSource; onAgain: () => void; onBack: () => void;
}) {
  const drill = useDrill({ rootEpd: epd, color, source, maxCpLoss: DEFAULT_MAX_CP_LOSS, openingName: name });
  return (
    <div>
      <h1>Drill{name ? ` — ${name}` : ""}</h1>
      <DrillWorkspace drill={drill} color={color} onAgain={onAgain} onBack={onBack} />
    </div>
  );
}
```

- [ ] **Step 4: Add "Drill" to `web/src/components/AppShell.tsx`**

Add an entry to the `NAV` array (after Study):

```ts
  { to: "/study", label: "Study" },
  { to: "/drill", label: "Drill" },
```

- [ ] **Step 5: Register the route in `web/src/router.tsx`**

Add the import and route, and include it in `addChildren`:

```ts
import { DrillPage } from "./routes/drill.js";
```

```ts
const drillRoute = createRoute({
  getParentRoute: () => rootRoute, path: "/drill", component: DrillPage,
  validateSearch: (s: Record<string, unknown>): { epd?: string; color?: "white" | "black"; source?: "masters" | "rating" } => {
    const epd = typeof s.epd === "string" ? s.epd : undefined;
    const color = s.color === "black" ? "black" : s.color === "white" ? "white" : undefined;
    const source = s.source === "rating" ? "rating" : s.source === "masters" ? "masters" : undefined;
    return { ...(epd ? { epd } : {}), ...(color ? { color } : {}), ...(source ? { source } : {}) };
  },
});
```

```ts
const routeTree = rootRoute.addChildren([dashboardRoute, leaksRoute, gamesRoute, reviewRoute, studyRoute, treeRoute, drillRoute]);
```

- [ ] **Step 6: Run the test, expect pass**

Run: `npm run test -w @coc/web -- drill`
Expected: PASS.

- [ ] **Step 7: Typecheck the web package**

Run: `npx tsc -p web/tsconfig.json --noEmit`
Expected: PASS — no type errors. (Per the project verification setup, the web package is type-checked separately from Vitest.)

- [ ] **Step 8: Commit**

```bash
git add web/src/routes/drill.tsx web/src/routes/drill.test.tsx web/src/components/AppShell.tsx web/src/router.tsx
git commit -m "feat(web): Drill page + /drill route + sidebar nav"
```

## Task 12: Update README status

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Refresh the status block (lines ~8–11)**

Replace the `> **Status:** MVP (Phase 0 + Phase 1)...` block with:

```markdown
> **Status:** Phases 0–4. Imports chess.com games, analyzes openings, and shows the leak
> report, repertoire **Tree**, per-game **Review**, **Study** (browse a line over book +
> our eval), and **Drill** (rehearse a picked opening against a book opponent, graded by
> the same rule as the leak report). Lichess import is still pending (see
> `docs/superpowers/specs/2026-06-15-chess-opening-coach-design.md`).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README status reflects Tree/Review/Study/Drill"
```

---

## Final verification

- [ ] **Run the full suite** (per the project's verification setup):
  - `npm test` (shared + server) — expect PASS; the engine integration test stays skipped without `RUN_ENGINE_TESTS=1`.
  - `npm run test -w @coc/web` — expect PASS.
  - Separate typechecks: `npx tsc -p server/tsconfig.json --noEmit` and `npx tsc -p web/tsconfig.json --noEmit` — expect no errors.
- [ ] **Manual smoke (deferred / needs the binary + seeded openings + a synced username):** open **Drill**, pick a recommended opening or search one, play the line; confirm a wrong move flags with a hint and retries, the opponent replies from the book, the line ends out-of-book with a first-try accuracy summary, and re-opening **Drill** still lists recommendations (results persisted).

---

## Self-review notes (for the implementer)

- **Spec coverage:** grading (Tasks 2, 4) · weighted opponent + seeded RNG (Task 1, used in 9) · `drill_attempts` + recommended query (Tasks 5–7) · routes/wiring (Task 8) · loop with retry-until-correct + degrade paths (Task 9) · split feedback/theory panel + orientation (Task 10) · route/nav + recommendations + picker (Task 11) · graceful degradation (Task 9: empty book → line ends; ungradable → accept; 503 → null → ends).
- **Parity claim is precise:** the shared `moveCpLoss` makes the cp-loss arithmetic identical between the classifier and the drill grader (Task 4 test). The *pass/leak* booleans still differ by threshold by design (a leak is mistake-level out-of-book; a drill pass uses `maxCpLoss`).
- **First-try accounting:** `recordedRef` guarantees one recorded attempt per position per line; retries and the eventual passing move are not recorded.

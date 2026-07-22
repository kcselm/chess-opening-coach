# Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted, live-read Settings surface (engine, classification thresholds, drill SM-2 tuning, sync defaults) editable from a `/settings` page, replacing the hardcoded startup constants and engine env vars.

**Architecture:** One `Settings` Zod schema + `DEFAULT_SETTINGS` in `@coc/shared` is the single source of truth. The server stores it as one JSON row in a `settings` table and reads `getSettings(db)` **live** in each route/operation instead of at startup. Changes are **future-only** — they govern the next sync/analysis/drill; nothing already stored is reprocessed. The drill scheduler's grade buckets / ease factors become optional parameters (defaulted to today's values), threaded from settings. See `docs/superpowers/specs/2026-07-21-settings-page-design.md`.

**Tech Stack:** TypeScript, Node ≥22, Hono + Drizzle/libSQL, `chess.js`, React + Vite + TanStack Router/Query, Zod, Vitest + Testing Library.

## Global Constraints

- **Packages:** `@coc/shared`, `@coc/server`, `@coc/web` (npm workspaces). New shared code is re-exported from `shared/src/index.ts`. Server/web import it as `@coc/shared`, which resolves to the **built** `shared/dist` — so **rebuild shared (`npm run build -w @coc/shared`) after any shared change** before server/web typecheck or their Vitest runs.
- **Source of truth:** `Settings` (Zod) + `DEFAULT_SETTINGS` live in `@coc/shared`; server and web both import them. `DEFAULT_SETTINGS` doubles as the merge base so a stored blob written before a field existed still validates.
- **Future-only:** no reprocessing, no re-run buttons, no auto-reprocess on save. Settings affect the next operation. The leak report still reflects a new `thresholds.mistake` immediately because leaks are a live query filter (reading the setting, not reprocessing).
- **Timestamps:** epoch **seconds**, injected (`now` / `reviewedAt`); **no `Date.now()`** in shared or test paths (breaks determinism).
- **Test runner:** Vitest. Server tests run in `node`, web in `jsdom`. In-memory DB tests create tables inline with `CREATE TABLE` (mirroring existing tests). No live network; time is injected.
- **Verification (this repo):** tests are `npm run test -w @coc/shared` · `-w @coc/server` · `-w @coc/web` (the server engine integration test is skipped without the binary — **1 skip is normal**). **Typechecks are NOT in any test/build script** — run `npx tsc -p server/tsconfig.json --noEmit` and `npx tsc -p web/tsconfig.json --noEmit` after type/schema changes.
- **Git:** work on a feature branch (`feat/settings-page`); the dev branch is `master` (there is no `main`). **Stage files explicitly — never `git add -A`/`git add .`; never commit `server/engine/` or `server/data/`.**
- **Commits:** conventional-commit style, one per task step where indicated.

---

## Task 0: Branch

- [ ] **Step 1: Create the feature branch**

Run: `git switch -c feat/settings-page`
Expected: `Switched to a new branch 'feat/settings-page'`.

---

# Shared package

## Task 1: Parameterize the SM-2 scheduler (grade buckets + ease) — pure

**Files:**
- Modify: `shared/src/srs.ts`
- Modify: `shared/src/srs.test.ts` (append cases; leave the existing ones untouched)

**Interfaces:**
- Consumes: `CardState` (`./schemas.js`).
- Produces: `GradeBuckets` (`{ fail; pass; best }`), `EaseParams` (`{ start; floor }`), `DrillTuning` (`{ buckets; ease }`); `DEFAULT_GRADE_BUCKETS`, `DEFAULT_EASE`, `DEFAULT_DRILL_TUNING`; `gradeFromDrill(a, buckets?)` and `scheduleReview(prev, grade, reviewedAt, ease?)` — new optional params **defaulted to today's constants** so existing behavior/callers/tests are unchanged.

- [ ] **Step 1: Append the failing tests to `shared/src/srs.test.ts`**

Add these two `describe` blocks at the end of the file (the existing imports already bring in `gradeFromDrill`, `scheduleReview`, and `CardState`):

```ts
describe("gradeFromDrill (custom buckets)", () => {
  it("uses the provided buckets instead of the defaults", () => {
    const buckets = { fail: 1, pass: 3, best: 4 };
    expect(gradeFromDrill({ pass: false, cpLoss: 80 }, buckets)).toBe(1);
    expect(gradeFromDrill({ pass: true, cpLoss: 30 }, buckets)).toBe(3);
    expect(gradeFromDrill({ pass: true, cpLoss: 0 }, buckets)).toBe(4);
  });
});

describe("scheduleReview (custom ease)", () => {
  it("starts a new card from the provided ease.start", () => {
    // grade 4 leaves EF unchanged, so a brand-new card keeps ease.start exactly
    expect(scheduleReview(null, 4, 0, { start: 2.0, floor: 1.3 }).easeFactor).toBeCloseTo(2.0, 5);
  });
  it("floors the ease factor at the provided ease.floor after repeated lapses", () => {
    let s: CardState | null = null;
    for (let i = 0; i < 10; i++) s = scheduleReview(s, 2, i, { start: 2.5, floor: 1.5 });
    expect(s!.easeFactor).toBe(1.5);
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `npm run test -w @coc/shared -- srs`
Expected: FAIL — `gradeFromDrill`/`scheduleReview` don't accept the extra argument yet (TypeScript/assertion error).

- [ ] **Step 3: Rewrite `shared/src/srs.ts`**

Replace the whole file with:

```ts
import type { CardState } from "./schemas.js";

export const EF_FLOOR = 1.3;
export const EF_START = 2.5;

export interface GradeBuckets { fail: number; pass: number; best: number }
export interface EaseParams { start: number; floor: number }
export interface DrillTuning { buckets: GradeBuckets; ease: EaseParams }

export const DEFAULT_GRADE_BUCKETS: GradeBuckets = { fail: 2, pass: 4, best: 5 };
export const DEFAULT_EASE: EaseParams = { start: EF_START, floor: EF_FLOOR };
export const DEFAULT_DRILL_TUNING: DrillTuning = { buckets: DEFAULT_GRADE_BUCKETS, ease: DEFAULT_EASE };

/** Map a first-try drill outcome to an SM-2 quality grade 0–5. Buckets default to fail→2 (a lapse,
 *  q<3), in-book pass→4, best move (cpLoss 0)→5. Ungradable moves never reach here. */
export function gradeFromDrill(
  a: { pass: boolean; cpLoss: number | null },
  buckets: GradeBuckets = DEFAULT_GRADE_BUCKETS,
): number {
  if (!a.pass) return buckets.fail;
  return a.cpLoss === 0 ? buckets.best : buckets.pass;
}

/** Advance one card's SM-2 state given a review grade. `prev` is null on the first-ever review.
 *  Pure — time is passed in as `reviewedAt` (epoch seconds); no Date.now(). `ease` sets the starting
 *  ease factor for a new card and the floor; both default to the SM-2 standard 2.5 / 1.3. */
export function scheduleReview(
  prev: CardState | null, grade: number, reviewedAt: number,
  ease: EaseParams = DEFAULT_EASE,
): CardState {
  const efPrev = prev?.easeFactor ?? ease.start;
  const repsPrev = prev?.reps ?? 0;
  const intervalPrev = prev?.intervalDays ?? 0;

  const ef = Math.max(ease.floor, efPrev + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));

  let reps: number, intervalDays: number;
  if (grade >= 3) {
    reps = repsPrev + 1;
    intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(intervalPrev * ef);
  } else {
    reps = 0;
    intervalDays = 1;
  }
  return {
    easeFactor: ef, intervalDays, reps,
    dueAt: reviewedAt + intervalDays * 86400,
    lastReviewedAt: reviewedAt, lastGrade: grade,
  };
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npm run test -w @coc/shared -- srs`
Expected: PASS — both the original SM-2 cases and the two new custom-tuning blocks.

- [ ] **Step 5: Build shared**

Run: `npm run build -w @coc/shared`
Expected: PASS (emits `shared/dist`, no type errors).

- [ ] **Step 6: Commit**

```bash
git add shared/src/srs.ts shared/src/srs.test.ts
git commit -m "feat(shared): parameterize SM-2 scheduler with grade buckets + ease (defaults unchanged)"
```

## Task 2: `Settings` contract + `DEFAULT_SETTINGS` + helpers (pure)

**Files:**
- Create: `shared/src/settings.ts`
- Create: `shared/src/settings.test.ts`
- Modify: `shared/src/index.ts` (barrel)

**Interfaces:**
- Consumes: `TimeClass` (`./schemas.js`), `DrillTuning` (`./srs.js`).
- Produces: `Settings` (Zod schema + type); `DEFAULT_SETTINGS: Settings`; `parseSettings(raw: unknown): Settings` (merge over defaults, validate, throw on invalid); `drillTuningFromSettings(s: Settings): DrillTuning`.

- [ ] **Step 1: Write the failing test**

Create `shared/src/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Settings, DEFAULT_SETTINGS, parseSettings, drillTuningFromSettings } from "./settings.js";

describe("DEFAULT_SETTINGS", () => {
  it("is a valid Settings value", () => {
    expect(() => Settings.parse(DEFAULT_SETTINGS)).not.toThrow();
    expect(DEFAULT_SETTINGS.engine.depth).toBe(18);
    expect(DEFAULT_SETTINGS.thresholds).toEqual({ inaccuracy: 50, mistake: 100, blunder: 200 });
  });
});

describe("parseSettings", () => {
  it("returns the defaults for an empty/undefined blob", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("merges a partial stored blob over the defaults (missing fields fall back)", () => {
    const merged = parseSettings({ engine: { depth: 22 } });
    expect(merged.engine.depth).toBe(22);       // overridden
    expect(merged.engine.threads).toBe(4);      // default filled
    expect(merged.thresholds.mistake).toBe(100); // untouched group defaulted
  });

  it("throws on a value that violates the schema (non-increasing thresholds)", () => {
    expect(() => parseSettings({ thresholds: { inaccuracy: 100, mistake: 50, blunder: 200 } })).toThrow();
  });
});

describe("drillTuningFromSettings", () => {
  it("maps the drill group onto a DrillTuning", () => {
    expect(drillTuningFromSettings(DEFAULT_SETTINGS)).toEqual({
      buckets: { fail: 2, pass: 4, best: 5 },
      ease: { start: 2.5, floor: 1.3 },
    });
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -w @coc/shared -- settings`
Expected: FAIL — `Cannot find module './settings.js'`.

- [ ] **Step 3: Implement `shared/src/settings.ts`**

```ts
import { z } from "zod";
import { TimeClass } from "./schemas.js";
import type { DrillTuning } from "./srs.js";

export const Settings = z.object({
  engine: z.object({
    depth:    z.number().int().min(6).max(30),
    multipv:  z.number().int().min(1).max(10),
    threads:  z.number().int().min(1).max(64),
    maxPlies: z.number().int().min(4).max(60),     // opening-phase boundary (was MAX_PLIES=30)
  }),
  thresholds: z.object({                            // cp-loss classification labels
    inaccuracy: z.number().int().min(1),
    mistake:    z.number().int().min(1),
    blunder:    z.number().int().min(1),
  }).refine((t) => t.inaccuracy < t.mistake && t.mistake < t.blunder, {
    message: "thresholds must be strictly increasing (inaccuracy < mistake < blunder)",
  }),
  drill: z.object({
    gradeFail: z.number().int().min(0).max(5),      // 2 (lapse, q<3)
    gradePass: z.number().int().min(0).max(5),      // 4 (in-book pass with loss)
    gradeBest: z.number().int().min(0).max(5),      // 5 (best move, cpLoss 0)
    efStart:   z.number().min(1.3),                 // 2.5
    efFloor:   z.number().min(1.0),                 // 1.3
  }),
  sync: z.object({
    source:      z.enum(["chesscom", "lichess"]),
    timeClasses: z.array(TimeClass).min(1),
    sinceDays:   z.number().int().min(1).max(3650), // Dashboard look-back window (was hardcoded 90)
  }),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  engine: { depth: 18, multipv: 3, threads: 4, maxPlies: 30 },
  thresholds: { inaccuracy: 50, mistake: 100, blunder: 200 },
  drill: { gradeFail: 2, gradePass: 4, gradeBest: 5, efStart: 2.5, efFloor: 1.3 },
  sync: { source: "chesscom", timeClasses: ["rapid", "blitz", "classical"], sinceDays: 90 },
};

/** Merge an arbitrary stored value over the defaults, group by group, then validate. A blob written
 *  before a field existed still parses — the default fills the gap. Throws on an invalid value
 *  (surfaces rather than silently falling back). */
export function parseSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Record<keyof Settings, Record<string, unknown>>>;
  return Settings.parse({
    engine:     { ...DEFAULT_SETTINGS.engine,     ...(r.engine ?? {}) },
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(r.thresholds ?? {}) },
    drill:      { ...DEFAULT_SETTINGS.drill,      ...(r.drill ?? {}) },
    sync:       { ...DEFAULT_SETTINGS.sync,       ...(r.sync ?? {}) },
  });
}

/** Project the drill group onto the scheduler's DrillTuning shape. */
export function drillTuningFromSettings(s: Settings): DrillTuning {
  return {
    buckets: { fail: s.drill.gradeFail, pass: s.drill.gradePass, best: s.drill.gradeBest },
    ease: { start: s.drill.efStart, floor: s.drill.efFloor },
  };
}
```

- [ ] **Step 4: Add the barrel export in `shared/src/index.ts`**

Append the `settings` line so the file reads:

```ts
export * from "./schemas.js";
export * from "./epd.js";
export * from "./grade.js";
export * from "./rng.js";
export * from "./srs.js";
export * from "./settings.js";
```

- [ ] **Step 5: Run the test, expect pass**

Run: `npm run test -w @coc/shared -- settings`
Expected: PASS.

- [ ] **Step 6: Build shared (so server/web resolve the new exports)**

Run: `npm run build -w @coc/shared`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/src/settings.ts shared/src/settings.test.ts shared/src/index.ts
git commit -m "feat(shared): Settings schema + defaults + parse/drill-tuning helpers"
```

---

# Server package

## Task 3: `settings` table + migration

**Files:**
- Modify: `server/src/db/schema.ts` (append the table)
- Generate: `server/drizzle/0003_*.sql` (filename auto-assigned by drizzle-kit)

**Interfaces:**
- Produces: `schema.settings` — columns `id (integer PK)`, `json (text)`.

- [ ] **Step 1: Append the table to `server/src/db/schema.ts`**

Add at the end of the file (`sqliteTable`, `text`, `integer` are already imported):

```ts
export const settings = sqliteTable("settings", {
  id:   integer("id").primaryKey(), // always 1 — a single-row store
  json: text("json").notNull(),     // a Settings value, validated on read and write
});
```

- [ ] **Step 2: Generate the migration SQL**

Run: `npm run db:generate -w @coc/server`
Expected: a new file `server/drizzle/0003_*.sql` containing `CREATE TABLE `settings` (...)`.

- [ ] **Step 3: Apply it to the local DB**

Run: `npm run db:migrate -w @coc/server`
Expected: `migrations applied`; the `settings` table exists in `server/data/app.db`.

- [ ] **Step 4: Commit**

```bash
git add server/src/db/schema.ts server/drizzle
git commit -m "feat(server): settings table + migration"
```

## Task 4: Settings store (`getSettings` / `saveSettings`)

**Files:**
- Create: `server/src/settings/settingsStore.ts`
- Test: `server/src/settings/settingsStore.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS`, `parseSettings`, `Settings` (`@coc/shared`); `schema.settings`.
- Produces: `getSettings(db: Db): Promise<Settings>` (row 1, merged over defaults); `saveSettings(db: Db, next: Settings): Promise<Settings>` (validate + upsert row 1).

- [ ] **Step 1: Write the failing test**

Create `server/src/settings/settingsStore.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getSettings, saveSettings } from "./settingsStore.js";
import { DEFAULT_SETTINGS } from "@coc/shared";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE settings (id integer primary key, json text);`);
  return drizzle(c, { schema });
}

describe("settingsStore", () => {
  it("returns the defaults when no row exists", async () => {
    const db = await memDb();
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips a saved change", async () => {
    const db = await memDb();
    const next = { ...DEFAULT_SETTINGS, engine: { ...DEFAULT_SETTINGS.engine, depth: 22 } };
    const saved = await saveSettings(db, next);
    expect(saved.engine.depth).toBe(22);
    expect((await getSettings(db)).engine.depth).toBe(22);
  });

  it("merges a stored blob that predates a field", async () => {
    const db = await memDb();
    await db.insert(schema.settings).values({ id: 1, json: JSON.stringify({ engine: { depth: 20 } }) });
    const s = await getSettings(db);
    expect(s.engine.depth).toBe(20);     // stored
    expect(s.engine.threads).toBe(4);    // default filled
    expect(s.thresholds.mistake).toBe(100);
  });

  it("rejects an invalid settings value", async () => {
    const db = await memDb();
    const bad = { ...DEFAULT_SETTINGS, thresholds: { inaccuracy: 100, mistake: 50, blunder: 200 } };
    await expect(saveSettings(db, bad as typeof DEFAULT_SETTINGS)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -w @coc/server -- settingsStore`
Expected: FAIL — `Cannot find module './settingsStore.js'`.

- [ ] **Step 3: Implement `server/src/settings/settingsStore.ts`**

```ts
import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "@coc/shared";
import { schema, type Db } from "../db/client.js";

/** Read the single settings row (id 1), merged over DEFAULT_SETTINGS. Missing row → defaults. */
export async function getSettings(db: Db): Promise<Settings> {
  const row = (await db.select().from(schema.settings).where(eq(schema.settings.id, 1)))[0];
  if (!row) return DEFAULT_SETTINGS;
  return parseSettings(JSON.parse(row.json));
}

/** Validate `next` (rejects e.g. non-increasing thresholds or out-of-range values) and upsert row 1. */
export async function saveSettings(db: Db, next: Settings): Promise<Settings> {
  const parsed = parseSettings(next);
  const json = JSON.stringify(parsed);
  await db
    .insert(schema.settings)
    .values({ id: 1, json })
    .onConflictDoUpdate({ target: schema.settings.id, set: { json } });
  return parsed;
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -w @coc/server -- settingsStore`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/settings/settingsStore.ts server/src/settings/settingsStore.test.ts
git commit -m "feat(server): settings store (get/save, merge-over-defaults, validate)"
```

## Task 5: `/settings` routes (GET + PUT)

**Files:**
- Modify: `server/src/routes/app.ts`
- Test: `server/src/routes/app.settings.test.ts`

**Interfaces:**
- Consumes: `Settings`, `DEFAULT_SETTINGS` (`@coc/shared`).
- Produces: two `AppDeps` fields — `getSettings?: () => Promise<Settings>` and `saveSettings?: (next: Settings) => Promise<Settings>`; routes `GET /settings`, `PUT /settings`; unchanged `AppType` export shape (routes just append to the chain).

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/app.settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { DEFAULT_SETTINGS, type Settings } from "@coc/shared";
import { RunStore } from "../runStore.js";

function appWithSettings() {
  let current: Settings = DEFAULT_SETTINGS;
  return createApp({
    runStore: new RunStore(),
    startSync: async () => {},
    getSettings: async () => current,
    saveSettings: async (next) => { current = next; return current; },
  });
}

const putBody = (s: Settings) => ({
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s),
});

describe("/settings", () => {
  it("GET returns the defaults initially", async () => {
    const res = await appWithSettings().request("/settings");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULT_SETTINGS);
  });

  it("PUT persists and a later GET reflects it", async () => {
    const app = appWithSettings();
    const next: Settings = { ...DEFAULT_SETTINGS, engine: { ...DEFAULT_SETTINGS.engine, depth: 22 } };
    const put = await app.request("/settings", putBody(next));
    expect(put.status).toBe(200);
    expect((await put.json()).engine.depth).toBe(22);
    const get = await app.request("/settings");
    expect((await get.json()).engine.depth).toBe(22);
  });

  it("PUT rejects an invalid body (non-increasing thresholds) with 400", async () => {
    const bad = { ...DEFAULT_SETTINGS, thresholds: { inaccuracy: 100, mistake: 50, blunder: 200 } };
    const res = await appWithSettings().request("/settings", putBody(bad as Settings));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -w @coc/server -- app.settings`
Expected: FAIL — `getSettings`/`saveSettings` aren't in `AppDeps` and the routes don't exist (compile/404).

- [ ] **Step 3: Add the imports, deps, and routes in `server/src/routes/app.ts`**

Add `Settings` and `DEFAULT_SETTINGS` to the value import from `@coc/shared` (the line that currently imports `SyncRequest, DrillResultsBatch, ...`):

```ts
import { SyncRequest, DrillResultsBatch, Settings, DEFAULT_SETTINGS, type Leak, type GameSummary,
  type GameReview, type LeakOccurrence, type OpeningListItem, type ExploreResult, type PositionAnalysis,
  type TreeChildren, type DrillRecommendation } from "@coc/shared";
```

Add the two fields to the `AppDeps` interface (next to the other optional deps):

```ts
  getSettings?: () => Promise<Settings>;
  saveSettings?: (next: Settings) => Promise<Settings>;
```

Add the two routes to the chain, immediately after the `.get("/drill/recommended", ...)` line and before `return app;`:

```ts
    .get("/settings", async (c) => c.json((await deps.getSettings?.()) ?? DEFAULT_SETTINGS))
    .put("/settings", zValidator("json", Settings), async (c) => {
      const next = c.req.valid("json");
      return c.json((await deps.saveSettings?.(next)) ?? next);
    })
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -w @coc/server -- app.settings`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/app.ts server/src/routes/app.settings.test.ts
git commit -m "feat(server): GET/PUT /settings routes"
```

## Task 6: Thread `DrillTuning` through the drill write path

**Files:**
- Modify: `server/src/drill/scheduleStore.ts`
- Modify: `server/src/drill/resultsStore.ts`
- Modify: `server/src/drill/backfillSchedule.ts`
- Modify: `server/src/drill/runBackfill.ts`
- Modify: `server/src/drill/scheduleStore.test.ts` (add a tuning test)
- Modify: `server/src/drill/resultsStore.test.ts` (add a forwarding test)

**Interfaces:**
- Consumes: `DEFAULT_DRILL_TUNING`, `DrillTuning`, `drillTuningFromSettings` (`@coc/shared`); `getSettings` (Task 4).
- Produces: `upsertCardReview(db, a, reviewedAt, tuning?)`, `saveDrillResults(db, attempts, now?, tuning?)`, `backfillSchedule(db, tuning?)` — all defaulting to `DEFAULT_DRILL_TUNING`, so existing callers/tests are unaffected.

- [ ] **Step 1: Add a failing tuning test to `server/src/drill/scheduleStore.test.ts`**

Append this test inside the existing `describe("upsertCardReview", ...)` block:

```ts
  it("grades with the provided tuning buckets (a fail mapped to a pass advances instead of lapsing)", async () => {
    const db = await memDb();
    await upsertCardReview(db, attempt({ pass: false, cpLoss: 90 }), 1000,
      { buckets: { fail: 4, pass: 4, best: 5 }, ease: { start: 2.5, floor: 1.3 } });
    const [card] = await db.select().from(schema.drillSchedule);
    expect(card).toMatchObject({ reps: 1, intervalDays: 1, lastGrade: 4 }); // default fail→2 would give reps 0
  });
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm run test -w @coc/server -- scheduleStore`
Expected: FAIL — `upsertCardReview` doesn't accept a 4th argument yet.

- [ ] **Step 3: Rewrite `server/src/drill/scheduleStore.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { scheduleReview, gradeFromDrill, DEFAULT_DRILL_TUNING,
  type DrillAttempt, type CardState, type DrillTuning } from "@coc/shared";
import { schema, type Db } from "../db/client.js";

/** Fold one first-try attempt into its (epd, color) card via SM-2: read the prior state, advance it,
 *  upsert. `tuning` sets the grade buckets + ease; defaults to the SM-2 standard. Used both
 *  per-attempt on save and per-row during backfill. */
export async function upsertCardReview(
  db: Db, a: DrillAttempt, reviewedAt: number, tuning: DrillTuning = DEFAULT_DRILL_TUNING
): Promise<void> {
  const prev =
    (await db
      .select()
      .from(schema.drillSchedule)
      .where(and(eq(schema.drillSchedule.epd, a.epd), eq(schema.drillSchedule.color, a.color))))[0] ?? null;
  const next: CardState = scheduleReview(prev, gradeFromDrill(a, tuning.buckets), reviewedAt, tuning.ease);
  await db
    .insert(schema.drillSchedule)
    .values({ epd: a.epd, color: a.color, openingEpd: a.openingEpd, openingName: a.openingName, ...next })
    .onConflictDoUpdate({
      target: [schema.drillSchedule.epd, schema.drillSchedule.color],
      set: { openingEpd: a.openingEpd, openingName: a.openingName, ...next },
    });
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `npm run test -w @coc/server -- scheduleStore`
Expected: PASS (existing tests + the new tuning test).

- [ ] **Step 5: Add a forwarding test to `server/src/drill/resultsStore.test.ts`**

Append this test inside the existing `describe("saveDrillResults", ...)` block:

```ts
  it("forwards drill tuning to the schedule fold", async () => {
    const db = await memDb();
    await saveDrillResults(db, [attempt({ pass: false, cpLoss: 90 })], () => 1000,
      { buckets: { fail: 4, pass: 4, best: 5 }, ease: { start: 2.5, floor: 1.3 } });
    const [card] = await db.select().from(schema.drillSchedule);
    expect(card).toMatchObject({ reps: 1, intervalDays: 1, lastGrade: 4 });
  });
```

- [ ] **Step 6: Run it, expect failure**

Run: `npm run test -w @coc/server -- resultsStore`
Expected: FAIL — `saveDrillResults` doesn't accept a 4th argument yet.

- [ ] **Step 7: Update `server/src/drill/resultsStore.ts`**

Change the import and the signature + the fold call. The new file:

```ts
import { DEFAULT_DRILL_TUNING, type DrillAttempt, type DrillTuning } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import { upsertCardReview } from "./scheduleStore.js";

/** Append first-try drill outcomes, all stamped with one timestamp. Append-only: replaying a line
 *  later just adds rows. Also folds each gradable attempt into its SM-2 card. Returns how many were
 *  written. `tuning` sets grade buckets + ease; defaults to the SM-2 standard. */
export async function saveDrillResults(
  db: Db, attempts: DrillAttempt[], now: () => number = () => Math.floor(Date.now() / 1000),
  tuning: DrillTuning = DEFAULT_DRILL_TUNING
): Promise<{ saved: number }> {
  if (attempts.length === 0) return { saved: 0 };
  const createdAt = now();
  await db.insert(schema.drillAttempts).values(
    attempts.map((a) => ({
      epd: a.epd, openingEpd: a.openingEpd, openingName: a.openingName, color: a.color,
      source: a.source, playedUci: a.playedUci, pass: a.pass, cpLoss: a.cpLoss, createdAt,
    }))
  );
  for (const a of attempts) {
    if (a.cpLoss === null) continue; // ungradable — never a review (matches backfill; keeps store⇄backfill parity)
    await upsertCardReview(db, a, createdAt, tuning);
  }
  return { saved: attempts.length };
}
```

- [ ] **Step 8: Run it, expect pass**

Run: `npm run test -w @coc/server -- resultsStore`
Expected: PASS (existing tests + the forwarding test).

- [ ] **Step 9: Update `server/src/drill/backfillSchedule.ts`**

Change the import, the signature, and the fold call:

```ts
import { asc } from "drizzle-orm";
import { DEFAULT_DRILL_TUNING, type Color, type BookSource, type DrillAttempt, type DrillTuning } from "@coc/shared";
import { schema, type Db } from "../db/client.js";
import { upsertCardReview } from "./scheduleStore.js";

/** Rebuild drill_schedule from scratch by replaying every drill_attempts row through SM-2 in
 *  chronological (id) order, under the current `tuning`. Idempotent: clears the table first, so it is
 *  safe to re-run to resync. Same function + order as the live per-attempt path. */
export async function backfillSchedule(
  db: Db, tuning: DrillTuning = DEFAULT_DRILL_TUNING
): Promise<{ cards: number }> {
  await db.delete(schema.drillSchedule);
  const rows = await db.select().from(schema.drillAttempts).orderBy(asc(schema.drillAttempts.id));
  for (const r of rows) {
    if (r.cpLoss === null) continue; // ungradable — never a review
    const a: DrillAttempt = {
      epd: r.epd, openingEpd: r.openingEpd, openingName: r.openingName,
      color: r.color as Color, source: r.source as BookSource,
      playedUci: r.playedUci, pass: r.pass, cpLoss: r.cpLoss,
    };
    await upsertCardReview(db, a, r.createdAt, tuning);
  }
  return { cards: (await db.select().from(schema.drillSchedule)).length };
}
```

- [ ] **Step 10: Update `server/src/drill/runBackfill.ts` to use current settings**

Replace the whole file (it now reads settings so a backfill uses the user's current buckets):

```ts
import "dotenv/config";
import { drillTuningFromSettings } from "@coc/shared";
import { createDb } from "../db/client.js";
import { getSettings } from "../settings/settingsStore.js";
import { backfillSchedule } from "./backfillSchedule.js";

const db = createDb();
const settings = await getSettings(db);
backfillSchedule(db, drillTuningFromSettings(settings)).then((r) => {
  console.log(`backfilled ${r.cards} drill cards`);
});
```

- [ ] **Step 11: Run the whole backfill suite, expect pass**

Run: `npm run test -w @coc/server -- backfillSchedule`
Expected: PASS — existing backfill tests still pass (default tuning; the parity test is unaffected).

- [ ] **Step 12: Commit**

```bash
git add server/src/drill/scheduleStore.ts server/src/drill/scheduleStore.test.ts server/src/drill/resultsStore.ts server/src/drill/resultsStore.test.ts server/src/drill/backfillSchedule.ts server/src/drill/runBackfill.ts
git commit -m "feat(server): thread drill SM-2 tuning through save/backfill (settings-driven)"
```

## Task 7: Engine setoption setters + drop env knobs from `start()`

**Files:**
- Modify: `server/src/engine/engineManager.ts`
- Test: `server/src/engine/engineManager.test.ts`

**Interfaces:**
- Produces: `EngineManager.setThreads(threads: number): void` and `setMultiPV(multipv: number): void` — send a UCI `setoption` if the engine is running, otherwise a safe no-op (`start()` applies the initial values). Applied at each sync/analysis start by the composition root (Task 8).

- [ ] **Step 1: Write the failing unit test (no binary needed)**

Create `server/src/engine/engineManager.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EngineManager } from "./engineManager.js";

describe("EngineManager setoption setters", () => {
  it("setThreads/setMultiPV are safe no-ops before start()", () => {
    const e = new EngineManager();
    expect(() => { e.setThreads(8); e.setMultiPV(5); }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm run test -w @coc/server -- engineManager.test`
Expected: FAIL — `setThreads`/`setMultiPV` don't exist.

- [ ] **Step 3: Add the setters and drop the env reads in `server/src/engine/engineManager.ts`**

Change the two `setoption` lines at the end of `start()` to use only the constructor opts (the env vars are superseded by the settings table):

```ts
    this.send(`setoption name Threads value ${this.opts.threads ?? 4}`);
    this.send(`setoption name MultiPV value ${this.opts.multipv ?? 3}`);
```

Add these two public methods (e.g. right after `private send(...)`):

```ts
  /** Apply Threads to the running engine (a UCI setoption). No-op before start(); start() applies the
   *  initial value. Safe between analyses — the queue serializes them, so the engine is idle here. */
  setThreads(threads: number): void {
    if (this.proc) this.send(`setoption name Threads value ${threads}`);
  }

  /** Apply MultiPV to the running engine (a UCI setoption). No-op before start(). */
  setMultiPV(multipv: number): void {
    if (this.proc) this.send(`setoption name MultiPV value ${multipv}`);
  }
```

- [ ] **Step 4: Run it, expect pass**

Run: `npm run test -w @coc/server -- engineManager.test`
Expected: PASS. (The gated `engineManager.integration.test.ts` still shows 1 skip without the binary.)

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/engineManager.ts server/src/engine/engineManager.test.ts
git commit -m "feat(server): engine setThreads/setMultiPV setoption; drop ENGINE_* env from start()"
```

## Task 8: Wire settings into the composition root + `.env.example`

**Files:**
- Modify: `server/src/index.ts` (replace startup constants with live `getSettings(db)` reads; apply engine setters; wire `/settings` deps + drill tuning)
- Modify: `server/.env.example` (drop the `ENGINE_*` knobs)

**Interfaces:**
- Consumes: `getSettings`, `saveSettings` (Task 4); `Settings`, `drillTuningFromSettings` (`@coc/shared`); `saveDrillResults(…, tuning)` (Task 6); `EngineManager.setThreads`/`setMultiPV` (Task 7).
- Produces: nothing new (composition root). Verified by typecheck + the full server suite.

- [ ] **Step 1: Replace `server/src/index.ts` with the live-read wiring**

```ts
import "dotenv/config";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { createApp } from "./routes/app.js";
import { RunStore } from "./runStore.js";
import { createDb, schema } from "./db/client.js";
import { EngineManager } from "./engine/engineManager.js";
import { sourceFor } from "./sources/factory.js";
import { ingestGames } from "./ingest/ingestService.js";
import { analyzePositions } from "./analysis/orchestrator.js";
import { getBook } from "./book/explorerClient.js";
import { classifyMoves } from "./classify/classifyService.js";
import { loadOpeningTable, pickOpening } from "./openings/seed.js";
import { getLeaks } from "./leaks/leaksQuery.js";
import { getGameReview } from "./games/gameReview.js";
import { getLeakOccurrences } from "./leaks/leakOccurrences.js";
import { searchOpenings } from "./openings/searchOpenings.js";
import { getExplore } from "./study/getExplore.js";
import { analyzeOnDemand } from "./study/analyzeOnDemand.js";
import { getTreeChildren } from "./tree/getTreeChildren.js";
import { saveDrillResults } from "./drill/resultsStore.js";
import { getDrillRecommendations } from "./drill/recommendedQuery.js";
import { getSettings, saveSettings } from "./settings/settingsStore.js";
import { drillTuningFromSettings, type SyncRequest, type Settings } from "@coc/shared";

const PORT = Number(process.env.PORT ?? 8787);

const db = createDb();
const runStore = new RunStore();
const engine = new EngineManager();
let engineStarted = false;
let activeRunId: string | null = null;

function engineVersion(): string {
  return (engine as any).version ?? "stockfish";
}

/** Start the engine on first use, then apply the current threads/MultiPV settings for this run. */
async function ensureEngine(s: Settings): Promise<void> {
  if (!engineStarted) { await engine.start(); engineStarted = true; }
  engine.setThreads(s.engine.threads);
  engine.setMultiPV(s.engine.multipv);
}

async function startSync(runId: string, req: SyncRequest) {
  activeRunId = runId; // set synchronously (before any await) so a concurrent POST sees it
  try {
    const s = await getSettings(db);
    await ensureEngine(s);
    runStore.update(runId, { phase: "fetching" });
    const source = sourceFor(req.source, process.env.LICHESS_TOKEN);
    const ingest = await ingestGames(db, source, req, s.engine.maxPlies, (gamesFetched) =>
      runStore.update(runId, { gamesFetched }));

    runStore.update(runId, { phase: "analyzing" });
    const analyzer = { version: engineVersion(),
      analyze: (fen: string, d: number, mpv: number) => engine.analyze(fen, d, mpv) };
    await analyzePositions(db, analyzer, { depth: s.engine.depth, multipv: s.engine.multipv },
      (positionsAnalyzed, positionsTotal) =>
        runStore.update(runId, { positionsAnalyzed, positionsTotal }));

    // book lookups for every analyzed position-before-a-move (masters)
    const epds = [...new Set((await db.select({ e: schema.moves.epdBefore }).from(schema.moves)).map((r) => r.e))];
    for (const epd of epds) { try { await getBook(db, epd, "masters"); } catch { /* book stays unknown */ } }

    // name openings per game from the positions it passed through
    runStore.update(runId, { phase: "classifying" });
    const table = await loadOpeningTable(db);
    const gameRows = await db.select().from(schema.games);
    for (const g of gameRows) {
      const epdsInOrder = (await db.select({ e: schema.moves.epdAfter, ply: schema.moves.ply })
        .from(schema.moves).where(eq(schema.moves.gameId, g.id))).sort((a, b) => a.ply - b.ply).map((r) => r.e);
      const op = pickOpening(epdsInOrder, table);
      if (op) await db.update(schema.games).set({ eco: op.eco, openingName: op.name }).where(eq(schema.games.id, g.id));
    }

    await classifyMoves(db, { depth: s.engine.depth, engineVersion: engineVersion(), thresholds: s.thresholds });

    runStore.update(runId, {
      phase: "done",
      message: ingest.skipped.length ? `Skipped ${ingest.skipped.length} unparseable game(s)` : undefined,
    });
  } catch (e) {
    runStore.update(runId, { phase: "error", message: (e as Error).message });
  } finally {
    activeRunId = null;
  }
}

const app = createApp({
  runStore, startSync,
  getActiveRunId: () => activeRunId,
  getSettings: () => getSettings(db),
  saveSettings: (next) => saveSettings(db, next),
  getLeaks: async () => {
    const s = await getSettings(db);
    return getLeaks(db, { minCpLoss: s.thresholds.mistake, depth: s.engine.depth, engineVersion: engineVersion(), limit: 50 });
  },
  getGames: async () => (await db.select().from(schema.games)).map((g) => ({
    id: g.id, source: g.source as "chesscom" | "lichess", openingName: g.openingName, eco: g.eco,
    myColor: g.myColor as "white" | "black", result: g.result as "win" | "loss" | "draw",
    timeClass: g.timeClass as "bullet" | "blitz" | "rapid" | "classical" | "daily",
    endTime: g.endTime, myRating: g.myRating, oppRating: g.oppRating })),
  getGame: async (id) => {
    const s = await getSettings(db);
    return getGameReview(db, id, { depth: s.engine.depth, engineVersion: engineVersion() });
  },
  getOccurrences: (epd, san) => getLeakOccurrences(db, epd, san),
  getOpenings: (q) => searchOpenings(db, q),
  explore: async (epd, source) => {
    const s = await getSettings(db);
    return getExplore(db, epd, source, { depth: s.engine.depth, engineVersion: engineVersion() });
  },
  analyzePosition: async (fen) => {
    const s = await getSettings(db);
    await ensureEngine(s);
    const analyzer = { version: engineVersion(), analyze: (f: string, d: number, mpv: number) => engine.analyze(f, d, mpv) };
    return analyzeOnDemand(db, analyzer, { depth: s.engine.depth, multipv: s.engine.multipv }, fen);
  },
  getTree: (color, epd) => getTreeChildren(db, color, epd),
  saveDrillResults: async (batch) => {
    const s = await getSettings(db);
    return saveDrillResults(db, batch.attempts, undefined, drillTuningFromSettings(s));
  },
  getDrillRecommendations: async () => {
    const s = await getSettings(db);
    const leaks = await getLeaks(db, { minCpLoss: s.thresholds.mistake, depth: s.engine.depth, engineVersion: engineVersion(), limit: 50 });
    return getDrillRecommendations(db, leaks, { now: Math.floor(Date.now() / 1000), limit: 30 });
  },
});
serve({ fetch: app.fetch, port: PORT });
console.log(`server on http://localhost:${PORT}`);
```

- [ ] **Step 2: Drop the `ENGINE_*` knobs from `server/.env.example`**

Delete the three lines `ENGINE_DEPTH=…`, `ENGINE_MULTIPV=…`, and `ENGINE_THREADS=…` (leave `STOCKFISH_PATH`, `DATABASE_URL`, `LICHESS_TOKEN` if present, and `PORT`). Add a short comment noting these now live in the Settings page, e.g. above `PORT`:

```
# Engine depth / MultiPV / threads and the classification thresholds are configured in-app on the
# Settings page (stored in the settings table), not here.
```

- [ ] **Step 3: Typecheck the server**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: PASS — confirms the live-read wiring, `classifyMoves` thresholds shape (`s.thresholds`), and the drill-tuning call all typecheck.

- [ ] **Step 4: Run the full server suite**

Run: `npm run test -w @coc/server`
Expected: all PASS with **1 skip** (engine integration). Existing route tests still pass because the new deps are optional.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/.env.example
git commit -m "feat(server): read settings live in the composition root; drop ENGINE_* env"
```

---

# Web package

## Task 9: Settings page + route + nav

**Files:**
- Create: `web/src/routes/settings.tsx`
- Test: `web/src/routes/settings.test.tsx`
- Modify: `web/src/router.tsx` (register the route)
- Modify: `web/src/components/AppShell.tsx` (nav item)

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS`, `Settings`, `TimeClass` (`@coc/shared`); `api.settings.$get` / `api.settings.$put` (typed from Task 5's `AppType`).
- Produces: `SettingsPage` component; `/settings` route + nav entry.

- [ ] **Step 1: Write the failing test**

Create `web/src/routes/settings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_SETTINGS, type Settings } from "@coc/shared";

const put = vi.fn(async ({ json }: { json: Settings }) => ({ json: async () => json }));
vi.mock("../api/client.js", () => ({
  api: {
    settings: {
      $get: vi.fn(async () => ({ json: async () => DEFAULT_SETTINGS })),
      $put: (arg: { json: Settings }) => put(arg),
    },
  },
}));

async function renderPage() {
  const { SettingsPage } = await import("./settings.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><SettingsPage /></QueryClientProvider>);
}

describe("SettingsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads settings, shows the depth re-sync warning, and disables Save until dirty", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Engine")).toBeInTheDocument());
    expect(screen.getByText(/only re-analyzed positions until you re-sync/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("edits a field and PUTs the changed settings", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Engine")).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue(String(DEFAULT_SETTINGS.engine.depth)), { target: { value: "22" } });
    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0].json.engine.depth).toBe(22);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm run test -w @coc/web -- settings.test`
Expected: FAIL — `Cannot find module './settings.js'`.

- [ ] **Step 3: Implement `web/src/routes/settings.tsx`**

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Settings, TimeClass } from "@coc/shared";
import { api } from "../api/client.js";

const TIME_CLASSES: TimeClass[] = ["bullet", "blitz", "rapid", "classical", "daily"];

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await (await api.settings.$get()).json()) as Settings,
  });
  const [form, setForm] = useState<Settings | null>(null);
  const save = useMutation({
    mutationFn: async (next: Settings) => (await (await api.settings.$put({ json: next })).json()) as Settings,
    onSuccess: (saved) => { qc.setQueryData(["settings"], saved); setForm(null); },
  });

  const current = form ?? data ?? null;
  if (isLoading || !current) return <p>Loading settings&hellip;</p>;

  const s = current;
  const dirty = form !== null;
  const patch = (p: Partial<Settings>) => setForm({ ...s, ...p });

  return (
    <div>
      <h1>Settings</h1>
      <p style={{ color: "#555", maxWidth: 560 }}>
        Changes apply going forward &mdash; existing analysis is not reprocessed. Re-sync to pick up
        engine and threshold changes on games you have already imported.
      </p>

      <section>
        <h2>Engine</h2>
        <Num label="Depth" value={s.engine.depth} min={6} max={30}
          note="Applies to the next sync. Existing evals were cached at the old depth, so the Leak and Review views show only re-analyzed positions until you re-sync."
          onChange={(depth) => patch({ engine: { ...s.engine, depth } })} />
        <Num label="MultiPV (lines)" value={s.engine.multipv} min={1} max={10}
          note="Applies to the next analysis."
          onChange={(multipv) => patch({ engine: { ...s.engine, multipv } })} />
        <Num label="Threads" value={s.engine.threads} min={1} max={64}
          note="Applied at the start of the next sync."
          onChange={(threads) => patch({ engine: { ...s.engine, threads } })} />
        <Num label="Opening-phase plies" value={s.engine.maxPlies} min={4} max={60}
          note="Applies to newly imported games."
          onChange={(maxPlies) => patch({ engine: { ...s.engine, maxPlies } })} />
      </section>

      <section>
        <h2>Classification (centipawn loss)</h2>
        <Num label="Inaccuracy ≥" value={s.thresholds.inaccuracy} min={1} max={1000}
          note="Move chips update on the next sync."
          onChange={(inaccuracy) => patch({ thresholds: { ...s.thresholds, inaccuracy } })} />
        <Num label="Mistake ≥" value={s.thresholds.mistake} min={1} max={1000}
          note="Also the leak cutoff — the Leak report re-ranks immediately."
          onChange={(mistake) => patch({ thresholds: { ...s.thresholds, mistake } })} />
        <Num label="Blunder ≥" value={s.thresholds.blunder} min={1} max={1000}
          note="Move chips update on the next sync."
          onChange={(blunder) => patch({ thresholds: { ...s.thresholds, blunder } })} />
      </section>

      <section>
        <h2>Drill (SM-2)</h2>
        <Num label="Grade: fail" value={s.drill.gradeFail} min={0} max={5} note="Future reviews only."
          onChange={(gradeFail) => patch({ drill: { ...s.drill, gradeFail } })} />
        <Num label="Grade: pass" value={s.drill.gradePass} min={0} max={5} note="Future reviews only."
          onChange={(gradePass) => patch({ drill: { ...s.drill, gradePass } })} />
        <Num label="Grade: best" value={s.drill.gradeBest} min={0} max={5} note="Future reviews only."
          onChange={(gradeBest) => patch({ drill: { ...s.drill, gradeBest } })} />
        <Num label="Ease start" value={s.drill.efStart} min={1.3} max={4} step={0.1} note="New cards only."
          onChange={(efStart) => patch({ drill: { ...s.drill, efStart } })} />
        <Num label="Ease floor" value={s.drill.efFloor} min={1} max={3} step={0.1} note="Future reviews only."
          onChange={(efFloor) => patch({ drill: { ...s.drill, efFloor } })} />
      </section>

      <section>
        <h2>Sync defaults</h2>
        <label style={{ display: "block", margin: "6px 0" }}>
          <span style={{ display: "inline-block", width: 160 }}>Source</span>
          <select value={s.sync.source}
            onChange={(e) => patch({ sync: { ...s.sync, source: e.target.value as "chesscom" | "lichess" } })}>
            <option value="chesscom">chess.com</option>
            <option value="lichess">Lichess</option>
          </select>
        </label>
        <fieldset style={{ margin: "6px 0", maxWidth: 420 }}>
          <legend>Time classes</legend>
          {TIME_CLASSES.map((tc) => (
            <label key={tc} style={{ marginRight: 10 }}>
              <input type="checkbox" checked={s.sync.timeClasses.includes(tc)}
                onChange={(e) => patch({ sync: { ...s.sync,
                  timeClasses: e.target.checked
                    ? [...s.sync.timeClasses, tc]
                    : s.sync.timeClasses.filter((x) => x !== tc) } })} />
              {tc}
            </label>
          ))}
        </fieldset>
        <Num label="Look-back (days)" value={s.sync.sinceDays} min={1} max={3650} note="Prefills the Dashboard."
          onChange={(sinceDays) => patch({ sync: { ...s.sync, sinceDays } })} />
      </section>

      <button onClick={() => save.mutate(s)} disabled={!dirty || save.isPending}>
        {save.isPending ? "Saving…" : "Save"}
      </button>
      {save.isSuccess && !dirty && <span style={{ marginLeft: 8, color: "#27ae60" }}>Saved</span>}
      {save.isError && <span style={{ marginLeft: 8, color: "#c0392b" }}>Save failed — check the values</span>}
    </div>
  );
}

function Num({ label, value, min, max, step, note, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; note?: string; onChange: (n: number) => void;
}) {
  return (
    <label style={{ display: "block", margin: "6px 0" }}>
      <span style={{ display: "inline-block", width: 160 }}>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))} />
      {note && <div style={{ fontSize: 11, color: "#777", marginLeft: 160 }}>{note}</div>}
    </label>
  );
}
```

- [ ] **Step 4: Register the route in `web/src/router.tsx`**

Add the import near the other route imports:

```ts
import { SettingsPage } from "./routes/settings.js";
```

Add the route definition (next to `drillRoute`):

```ts
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });
```

Add `settingsRoute` to the `addChildren([...])` array:

```ts
const routeTree = rootRoute.addChildren([dashboardRoute, leaksRoute, gamesRoute, reviewRoute, studyRoute, treeRoute, drillRoute, settingsRoute]);
```

- [ ] **Step 5: Add the nav item in `web/src/components/AppShell.tsx`**

Add a `Settings` entry at the end of the `NAV` array:

```ts
const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/leaks", label: "Leaks" },
  { to: "/games", label: "Games" },
  { to: "/tree", label: "Tree" },
  { to: "/study", label: "Study" },
  { to: "/drill", label: "Drill" },
  { to: "/settings", label: "Settings" },
];
```

- [ ] **Step 6: Run the test, expect pass**

Run: `npm run test -w @coc/web -- settings.test`
Expected: PASS (both SettingsPage tests).

- [ ] **Step 7: Typecheck the web package**

Run: `npx tsc -p web/tsconfig.json --noEmit`
Expected: PASS — confirms `api.settings.$get`/`$put` are typed from the server `AppType` and the route/nav additions compile.

- [ ] **Step 8: Commit**

```bash
git add web/src/routes/settings.tsx web/src/routes/settings.test.tsx web/src/router.tsx web/src/components/AppShell.tsx
git commit -m "feat(web): Settings page + /settings route + sidebar nav"
```

## Task 10: Dashboard consumes the sync defaults

**Files:**
- Modify: `web/src/routes/dashboard.tsx`
- Modify: `web/src/routes/dashboard.test.tsx`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS`, `Settings` (`@coc/shared`); `api.settings.$get`.
- Produces: no new exports; the Dashboard's `source`, `timeClasses`, and look-back window come from settings.

- [ ] **Step 1: Update `web/src/routes/dashboard.test.tsx` for the new settings fetch**

The Dashboard will now `useQuery` settings, so the test needs a `QueryClientProvider` and a mocked `api.settings.$get`. It uses a **non-default** settings fixture (30-day look-back, `["blitz"]` only) so the test genuinely fails against the current hardcoded Dashboard. Replace the whole file with:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_SETTINGS, type Settings } from "@coc/shared";

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, sync: { source: "chesscom", timeClasses: ["blitz"], sinceDays: 30 } };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = vi.fn(async () => ({ json: async () => ({ runId: "r1" }) })) as any;
vi.mock("../api/client.js", () => ({
  api: {
    sync: { $post: (...a: unknown[]) => post(...a) },
    settings: { $get: vi.fn(async () => ({ json: async () => SETTINGS })) },
  },
}));
vi.mock("../components/SyncProgress.js", () => ({
  SyncProgress: ({ runId }: { runId: string }) => <div>progress {runId}</div>,
}));

async function renderPage() {
  const { DashboardPage } = await import("./dashboard.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><DashboardPage /></QueryClientProvider>);
}

describe("DashboardPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("prefills the look-back + time classes from settings and posts them", async () => {
    await renderPage();
    // wait for the settings query to land (proves the value came from settings, not the old hardcoded 90)
    await waitFor(() => expect(screen.getByText(/last 30 days/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "lichess" } });
    fireEvent.change(screen.getByPlaceholderText(/username/), { target: { value: "magnus" } });
    fireEvent.click(screen.getByText(/Sync/));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const arg = post.mock.calls[0][0] as { json: { source: string; username: string; timeClasses: string[] } };
    expect(arg.json).toMatchObject({ source: "lichess", username: "magnus" });
    expect(arg.json.timeClasses).toEqual(["blitz"]);
    await waitFor(() => expect(screen.getByText(/progress r1/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm run test -w @coc/web -- dashboard.test`
Expected: FAIL — the current Dashboard renders "the last 90 days" and posts the hardcoded `["rapid","blitz","classical"]`, so both the `/last 30 days/` wait and the `["blitz"]` assertion fail.

- [ ] **Step 3: Update `web/src/routes/dashboard.tsx` to read settings**

Replace the whole file with:

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_SETTINGS, type Settings } from "@coc/shared";
import { api } from "../api/client.js";
import { SyncProgress } from "../components/SyncProgress.js";

type Source = "chesscom" | "lichess";
const SOURCE_LABELS: Record<Source, string> = { chesscom: "chess.com", lichess: "Lichess" };

export function DashboardPage() {
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await (await api.settings.$get()).json()) as Settings,
  });
  const s = settings ?? DEFAULT_SETTINGS;

  const [sourceOverride, setSourceOverride] = useState<Source | null>(null);
  const [username, setUsername] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const source = sourceOverride ?? s.sync.source;

  async function startSync() {
    const now = Math.floor(Date.now() / 1000);
    const res = await api.sync.$post({
      json: { source, username, since: now - s.sync.sinceDays * 86400, until: now,
        timeClasses: s.sync.timeClasses },
    });
    const { runId } = (await res.json()) as { runId: string };
    setRunId(runId);
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Analyze the last {s.sync.sinceDays} days of your games.</p>
      <select aria-label="Source" value={source} onChange={(e) => setSourceOverride(e.target.value as Source)}>
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

- [ ] **Step 4: Run it, expect pass**

Run: `npm run test -w @coc/web -- dashboard.test`
Expected: PASS.

- [ ] **Step 5: Typecheck the web package**

Run: `npx tsc -p web/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/dashboard.tsx web/src/routes/dashboard.test.tsx
git commit -m "feat(web): Dashboard prefills source/time-classes/look-back from settings"
```

---

## Task 11: Full verification + apply migration locally

**Files:** none (verification only).

- [ ] **Step 1: Rebuild shared**

Run: `npm run build -w @coc/shared`
Expected: PASS.

- [ ] **Step 2: Run every suite**

Run: `npm run test -w @coc/shared` then `npm run test -w @coc/server` then `npm run test -w @coc/web`
Expected: all PASS. The server `engineManager.integration.test.ts` shows **1 skip** (no Stockfish binary) — expected/normal.

- [ ] **Step 3: Run both typechecks**

Run: `npx tsc -p server/tsconfig.json --noEmit` then `npx tsc -p web/tsconfig.json --noEmit`
Expected: both PASS — no type errors.

- [ ] **Step 4: Apply the migration to the local DB**

Run: `npm run db:migrate -w @coc/server`
Expected: `migrations applied`; the `settings` table exists in `server/data/app.db` (from Task 3, safe to re-run).

- [ ] **Step 5: Smoke-check the endpoint (optional, needs a running server)**

Start the server (`npm run dev:server`) and `GET http://localhost:8787/settings`. Expect a JSON `Settings` object equal to the defaults (or your saved values). `PUT` a changed body and confirm `GET` reflects it. (Manual; not part of the automated suite.)

- [ ] **Step 6: No commit** — this task only verifies. Confirm `git status` shows nothing staged beyond the prior tasks, and that `server/engine/` and `server/data/` remain untracked/uncommitted.

---

## Notes for the implementer

- **`server/engine/` and `server/data/` must never be committed.** Stage files explicitly per task; never `git add -A`.
- **Rebuild `@coc/shared` after Tasks 1 and 2** before running server/web typechecks or their Vitest suites — the workspaces consume the built `dist`.
- **Future-only is deliberate:** there are no re-classify/re-analyze buttons. The only setting that changes stored views live is `thresholds.mistake` (the leak query filter); everything else takes effect on the next sync/analysis/drill, communicated by each field's inline note and the `engine.depth` warning.
- The drill loop (`useDrill`), the `drill_attempts` log, the leak/tree/review/study queries, and the recommendation query are otherwise **unchanged**; only the tuning inputs and the settings reads are new.

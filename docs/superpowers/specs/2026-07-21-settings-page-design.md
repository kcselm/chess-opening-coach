# Settings Page — Design Spec

**Date:** 2026-07-21
**Status:** Approved design, ready for implementation planning
**Builds on:** the original design (`2026-06-15-chess-opening-coach-design.md` §9 — "Settings" was
listed in the sidebar nav but never built) and the drill-SRS design
(`2026-07-15-drill-srs-design.md` §10 — grade buckets / EF constants named as "fixed v1 defaults,
tunable later like the other thresholds").

## 1. Overview

The app already computes everything a coach needs, but every behavioral knob is hardcoded or read
once from an env var at server startup: engine depth/MultiPV/threads, the opening-phase ply cap, the
inaccuracy/mistake/blunder cp thresholds, the SM-2 grade buckets, and the Dashboard's sync defaults.
Several specs promised these would be "all configurable"; none of them are editable from the app.

This adds a **Settings page**: one persisted `Settings` record (a single JSON row in SQLite),
authored in `@coc/shared`, read **live** by the server on each request/operation, and edited through
a `/settings` form. Changes are **future-only** — they govern the next sync, the next analysis, and
future drill reviews; nothing already stored on disk is reprocessed. Each field states when it takes
effect so the behavior is never silently surprising.

## 2. Goals / Non-goals

**Goals**
- One editable, persisted source of truth for the app's behavioral settings, replacing the
  scattered startup constants and engine env vars.
- Cover four groups: **engine** (depth, MultiPV, threads, opening-phase ply cap), **classification**
  thresholds, **drill SRS** tuning (grade buckets + ease-factor start/floor), and **sync defaults**
  (source, time classes, look-back window) that pre-fill the Dashboard.
- Read settings **live** server-side so a change applies to the next operation with no restart.
- Be honest about effect timing: label each field with when it takes effect; warn on the one field
  (engine depth) whose change makes existing analysis temporarily invisible.

**Non-goals (now)**
- **No reprocessing** — no "re-classify" or "re-analyze" buttons and no auto-reprocess on save.
  Settings are future-only; existing rows refresh on the next sync. (Locked decision, §3.)
- Per-view setting overrides (e.g. a different depth for one Study position) — global only.
- Editing secrets/paths (`STOCKFISH_PATH`, `LICHESS_TOKEN`, `DATABASE_URL`, `PORT`) from the UI —
  those stay env-only.
- Settings history / profiles / import-export.
- Remembering the last-used **username** as a default (per-use, not a setting).

## 3. Key decisions (locked)

| Area | Decision |
| --- | --- |
| Storage | A **single-row `settings` table** holding one validated JSON blob (like the existing `linesJson`/`movesJson` text columns) — adding a knob later is a shared-schema change, **no migration** |
| Source of truth | `Settings` Zod schema + `DEFAULT_SETTINGS` in **`@coc/shared`**, imported by server and web |
| Read model | Server reads `getSettings(db)` **live** per request/operation — not baked into startup closures |
| Effect timing | **Future-only, no reprocessing** — a change governs the next sync/analysis/drill; stored rows are untouched until the next sync |
| Env vars | The `ENGINE_DEPTH` / `ENGINE_MULTIPV` / `ENGINE_THREADS` env knobs are **superseded** by the table; secrets/paths (`STOCKFISH_PATH`, `LICHESS_TOKEN`, `DATABASE_URL`, `PORT`) stay env-only |
| Drill tuning | `srs.ts` pure functions gain optional buckets/EF params **defaulted to today's values**, so existing behavior and tests are unchanged; the server passes settings-derived tuning |
| Validation | Zod bounds + a refinement that thresholds are strictly increasing; the server re-validates every `PUT` (client bounds are a convenience, not the gate) |

## 4. Architecture

Everything below is new or a live-read refactor; the analysis pipeline, leak query, drill loop, and
all other views are otherwise unchanged.

```
shared/src/
  settings.ts   Settings (Zod schema, 4 groups) + DEFAULT_SETTINGS   ← the contract
  srs.ts        (modified) gradeFromDrill/scheduleReview gain optional buckets/EF params (defaulted)
  index.ts      (barrel) + export * from "./settings.js"

server/src/
  settings/settingsStore.ts   getSettings(db) / saveSettings(db, patch) — read/merge/validate/upsert
  db/schema.ts                + settings table (id, json) + migration 0003_*.sql
  routes/app.ts               + GET /settings, PUT /settings (partial body) → AppType
  index.ts                    (modified) route closures read getSettings(db) live, not startup consts
  drill/{resultsStore,backfillSchedule,scheduleStore}.ts  (modified) thread drill tuning through
  .env.example                (modified) drop the ENGINE_* knobs; keep paths/secrets

web/src/
  routes/settings.tsx         the form (4 sections) — load GET /settings, save PUT /settings
  router.tsx / components/AppShell.tsx   (modified) + /settings route + nav item
  routes/dashboard.tsx        (modified) initialize source/timeClasses/look-back from settings
```

### Data flow

- **Read:** any server handler that needs a knob calls `getSettings(db)` at request/operation time.
  `getSettings` selects row `1`, deep-merges the stored JSON over `DEFAULT_SETTINGS`, validates, and
  returns a full `Settings`. A missing row returns the defaults (fresh DB needs no seed).
- **Write:** the Settings form `PUT`s the full `Settings` object (it has all values loaded).
  `saveSettings(db, next)` validates it with the `Settings` schema and upserts row `1`, returning the
  stored value.
- **Consume:** `startSync` reads engine + `maxPlies` at run start; `getLeaks` reads
  `thresholds.mistake` + `engine.depth`; per-game review / explore / on-demand analysis read
  `engine.depth`; `saveDrillResults` + `backfillSchedule` read `drill`; the Dashboard reads `sync`.

## 5. Data model

### `settings` (new) — exactly one row

```ts
export const settings = sqliteTable("settings", {
  id:   integer("id").primaryKey(),   // always 1
  json: text("json").notNull(),       // a Settings value, validated on read and write
});
```

`drill_attempts`, `drill_schedule`, `position_evals`, and the rest are unchanged.

### The contract — `shared/src/settings.ts`

```ts
import { z } from "zod";
import { TimeClass } from "./schemas.js";

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
```

`Settings` is `z.infer`-only shared; `DEFAULT_SETTINGS` doubles as the merge base so a stored blob
written before a new field was added still validates (the default fills the gap).

## 6. Server

### `settings/settingsStore.ts`

```ts
export async function getSettings(db: Db): Promise<Settings>;    // row 1, merged over DEFAULT_SETTINGS
export async function saveSettings(db: Db, next: Settings): Promise<Settings>;    // validate + upsert
```

- `getSettings`: `select … where id = 1`; if absent → `DEFAULT_SETTINGS`; else deep-merge parsed JSON
  over `DEFAULT_SETTINGS`, `Settings.parse`, return. A parse failure surfaces (does not silently
  fall back), per the parent spec's "degrade, never silently swallow."
- `saveSettings`: `Settings.parse(next)` (rejects e.g. non-increasing thresholds or an out-of-range
  depth), `insert … onConflictDoUpdate` on `id = 1` with the serialized JSON, return the parsed value.

### Routes (`routes/app.ts`)

- `GET /settings` → `getSettings`.
- `PUT /settings` → `zValidator("json", Settings)` then `saveSettings`; returns the stored `Settings`.
  Both are added to the exported `AppType`, so `web/src/api/client.ts` is typed with no extra work.

### `index.ts` — startup-constants → live reads (the crux)

The closures passed to `createApp` stop closing over module-load constants
(`DEPTH`, `MULTIPV`, `MAX_PLIES`, `DEFAULT_THRESHOLDS`) and instead call `const s = await getSettings(db)`
at call time:

- `getLeaks` → `minCpLoss: s.thresholds.mistake`, `depth: s.engine.depth`.
- `startSync` → reads `s.engine` at run start: `{ depth, multipv }` for analysis, `maxPlies` for
  ingest, and applies `threads` to the engine (see below). The sync **request** already carries
  source/timeClasses/since from the client, so sync *defaults* are a Dashboard concern, not a
  server-side read here.
- `getGame` / `explore` / `analyzePosition` → `depth: s.engine.depth` (and `multipv` where used).
- `saveDrillResults` → `s.drill` tuning (buckets + EF). `getDrillRecommendations` reads the schedule,
  not the drill tuning; its internal `getLeaks` uses `s.thresholds.mistake` + `s.engine.depth`, as the
  leak wiring does today.

`engineVersion()` and the eval cache key are unchanged; because the key is `(epd, depth, engineVersion)`
and every read filters `WHERE depth = s.engine.depth`, raising the depth simply means existing evals
(stored at the old depth) are not read until re-analysis — the accepted future-only consequence (§7).

**Engine threads:** applied via `setoption name Threads value N` at the **start of the next sync**
(the engine is long-lived and started lazily; re-sending the option before a run is cheap and needs no
restart). `EngineManager` exposes a small `setThreads(n)` used by `startSync`. MultiPV is already
passed per-`analyze` call, so it needs no engine change.

### Drill tuning (`shared/src/srs.ts` + the three drill modules)

`srs.ts` gains optional parameters **defaulted to today's constants**, so existing callers and tests
are unaffected:

```ts
export function gradeFromDrill(
  a: { pass: boolean; cpLoss: number | null },
  buckets: { fail: number; pass: number; best: number } = { fail: 2, pass: 4, best: 5 },
): number { … }

export function scheduleReview(
  prev: CardState | null, grade: number, reviewedAt: number,
  ef: { start: number; floor: number } = { start: EF_START, floor: EF_FLOOR },
): CardState { … }
```

`upsertCardReview` takes a `DrillTuning` ({ buckets, ef }); `saveDrillResults` and `backfillSchedule`
read `s.drill` from `getSettings(db)` and pass it in. Public signatures of `saveDrillResults` and
`backfillSchedule` are otherwise unchanged. (A backfill re-run recomputes the whole schedule under the
**current** tuning — acceptable; the schedule is a rebuildable materialization of the attempts log.)

### `.env.example`

Drop `ENGINE_DEPTH` / `ENGINE_MULTIPV` / `ENGINE_THREADS` (now in the settings table); keep
`STOCKFISH_PATH`, `LICHESS_TOKEN`, `DATABASE_URL`, `PORT`.

## 7. Effect timing (the future-only contract, shown as inline notes)

| Setting | When it takes effect |
| --- | --- |
| `thresholds.mistake` | **Immediately** for the leak report (live query filter) |
| `thresholds.*` (Review chips) | **Next sync** — chips are written onto `moves` at classify time |
| `engine.depth` | **Next sync**; existing evals are cached at the old depth, so leak/Review show only re-analyzed positions — **explicit inline warning on this field** |
| `engine.multipv` | Next analysis (line count for new evals); existing evals unchanged |
| `engine.threads` | Start of the **next sync** (`setoption`) |
| `engine.maxPlies` | **Newly ingested** games only |
| `drill.*` | **Future** drill saves; existing `drill_schedule` rows unchanged |
| `sync.*` | Immediately (just prefills the Dashboard form) |

No re-run buttons, no auto-reprocessing. Each field carries a one-line note; `engine.depth` gets the
explicit "re-sync to see existing games at this depth" warning.

## 8. Web — the Settings page

- **`routes/settings.tsx`:** `useQuery(["settings"])` loads `GET /settings` into local form state; a
  Save mutation `PUT`s the dirty patch and invalidates the query. Four labelled sections — **Engine**,
  **Classification**, **Drill SRS**, **Sync defaults** — with number inputs, a source `<select>`, and
  time-class checkboxes. Save is disabled until the form is dirty and shows a brief "Saved"
  confirmation. Client-side bounds mirror the Zod schema; the server re-validates (a rejected `PUT`
  surfaces its message inline). Each field renders its effect-timing note.
- **Nav + route:** add `{ to: "/settings", label: "Settings" }` to `AppShell` `NAV` and a
  `settingsRoute` in `router.tsx`.
- **Dashboard:** `dashboard.tsx` initializes `source`, `timeClasses`, and the look-back window from
  `GET /settings` (via `useQuery`) instead of the current hardcoded values; `username` stays local and
  per-use. `since` becomes `now − sinceDays·86400`.

## 9. Error handling & edge cases

- **Fresh DB (no row):** `getSettings` returns `DEFAULT_SETTINGS`; the app works with zero setup.
- **Invalid `PUT`** (e.g. `mistake ≤ inaccuracy`, out-of-range depth): the Zod refinement/bounds
  reject; the route returns a 400 with the message; the form shows it and keeps the prior saved state.
- **Corrupt/older stored JSON:** deep-merge over defaults fills missing fields; a value that violates
  the schema surfaces as a read error rather than a silent reset (matches the parent spec).
- **Depth raised with existing data:** the leak/Review views legitimately show fewer/no rows for the
  new depth until a re-sync — communicated by the inline warning, not hidden.
- **Concurrent sync in progress:** settings are read at each operation's start, so a change mid-run
  affects the **next** run, never a live one — consistent with future-only.

## 10. Testing strategy (Vitest; TDD for pure/store logic)

- **shared:** `Settings` defaults, deep-merge (partial stored blob → full validated settings), and the
  strictly-increasing refinement + bounds; `srs.ts` with non-default buckets/EF changes grade+interval,
  and the defaulted calls reproduce current results (existing `srs.test.ts` untouched).
- **server:** `settingsStore` get/save round-trip, default-merge on a missing row and on a stored blob
  that predates a field, and rejection of an invalid `Settings` (e.g. non-increasing thresholds);
  `app.settings` route test (GET default → PUT persists → GET reflects); a drill test proving a
  non-default `drill.gradeBest`/`efStart` changes the resulting `drill_schedule` state (locks that
  tuning is actually threaded through).
- **web:** `settings.tsx` renders the four sections, loads values, saves a patch (mocked RPC), shows the
  effect-timing notes and the depth warning; `dashboard.tsx` uses the fetched sync defaults.
- **Not automated** (matches the README's deferred/manual note): confirming a real re-sync at a new
  depth re-populates the leak report end-to-end.

## 11. Open questions / future

- **Per-view overrides** (e.g. a deeper one-off analysis in Study) — deferred; global-only for v1.
- **Optional convenience "re-classify now"** — cheap (no engine, recomputes chips from cached evals);
  intentionally excluded here by the future-only decision, easy to add later if the manual re-sync
  feels heavy.
- **Remembering the last username / a saved profile of usernames** — a small Dashboard convenience,
  out of scope for a settings-of-behavior page.
- **Grade-bucket UX** — exposing raw SM-2 grades (0–5) is developer-ish; a friendlier mapping
  ("treat a passed-but-imperfect move as: easy / good / hard") could replace the raw numbers later.

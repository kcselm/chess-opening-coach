# Drill Spaced-Repetition (SM-2) — Design Spec

**Date:** 2026-07-15
**Status:** Approved design, ready for implementation planning
**Builds on:** the Phase 4 drilling design (`2026-06-24-phase-4-drilling-design.md` §2, §10),
which recorded per-position pass/fail in an append-only table specifically so
"ease/interval columns and a scheduler later" would be additive, not a rewrite.

## 1. Overview

Today the Drill feature recommends what to practice with a coarse rule: an opening is
`stale` if it was not drilled in the last 14 days. This spec replaces that with real
**spaced repetition**: every position the user drills becomes a *card* with its own
SM-2 schedule (ease factor + interval + due date), so review time concentrates on the
exact positions the user is shakiest on, spaced out automatically as they succeed.

The feature is deliberately additive. It reuses the existing drill loop untouched, keeps
`drill_attempts` as the immutable event log, and adds one pure scheduler module, one
materialized schedule table, a schedule upsert on the existing save path, a rewritten
recommendation branch, and a one-time backfill.

## 2. Goals / Non-goals

**Goals**
- Schedule each drilled position with SM-2 so it resurfaces right before it would be forgotten.
- Grade reviews from the drill's existing first-try `pass` + `cpLoss` signal — no new capture.
- Keep **leaks** (objective, from real games) as the top recommendation signal; let SM-2 own
  the cadence of everything already practiced.
- Preserve the current session feel: pick an opening, play the line out, review due positions
  in passing (reuse `useDrill`).
- Seed schedules from existing drill history on migration, so day one reflects past practice.

**Non-goals (now)**
- FSRS or any fitted memory model — SM-2 is what the parent spec named and is sufficient.
- A separate isolated "flashcard" review mode that jumps to a bare FEN — session stays
  line-based (see §4 decision "Session shape").
- Steering the opponent toward the most-overdue positions — accepted limitation of the
  line-based session (§8); a future enhancement, not v1.
- Configurable grade buckets / EF constants — fixed v1 defaults, tunable later like the
  other thresholds.
- Curated/editable repertoires, multi-move puzzles, middlegame drilling — unchanged from the
  parent spec's non-goals.

## 3. Key decisions (locked)

| Area | Decision |
| --- | --- |
| Card granularity | **Per-position** — a card is `(epd, color)`, the position the user was asked to move in |
| Session shape | **Reuse the existing drill loop** — play the line out; due positions are reviewed and rescheduled as they are passed through |
| Algorithm | **SM-2** (ease factor + interval + reps), quality grade derived from `pass` / `cpLoss` buckets |
| Grade buckets | fail → `2` (lapse); in-book pass with loss → `4`; best move (`cpLoss === 0`) → `5` |
| Recommendation reasons | **`leak` (top) + `due`** — SM-2's `due` replaces the old `failed` and `stale` reasons |
| Schedule storage | **Materialized `drill_schedule` table**, an incremental SM-2 fold of `drill_attempts` |
| Existing history | **Backfill** — replay the existing `drill_attempts` log through the scheduler once |
| Timestamps | epoch **seconds**, injected (`now` / `reviewedAt`); no `Date.now()` in shared/test paths |

## 4. Architecture

Everything below is new; everything not listed (the drill loop, `drill_attempts`, the leak
query, the explorer workspace) is reused unchanged.

```
shared/src/
  srs.ts        scheduleReview() — pure SM-2 (ease/interval/due) + gradeFromDrill() (pass/cpLoss → 0–5)
  schemas.ts    DrillReason: ["leak","failed","stale"] → ["leak","due"]; + CardState

server/src/drill/
  scheduleStore.ts       upsertCardReview() — fold one attempt into its card; read due cards
  resultsStore.ts        (modified) — after inserting attempts, upsert each card's schedule
  recommendedQuery.ts    (modified) — replace the failed+stale block with a single "due" block
  backfillSchedule.ts    one-time fold of drill_attempts → drill_schedule (a db script)

server/src/db/schema.ts  + drill_schedule table + migration
server/src/index.ts      (modified) — recommendation wiring drops staleDays; add backfill script entry

web/src/routes/drill.tsx (modified) — reason chips leak/due; a "N due" count
```

### Data flow (one drill session)

1. The user drills an opening — the **existing** `useDrill` loop, unchanged; it posts first-try
   attempts at line end.
2. `saveDrillResults` inserts the attempts (as today) **and** upserts each position's
   `drill_schedule` row via `scheduleReview(prev, gradeFromDrill(attempt), reviewedAt)`.
3. `getDrillRecommendations` returns **leaks** (top, unchanged) then **due** openings — those
   containing ≥1 card past its `dueAt`, ranked by how many due cards they hold.
4. Clicking a due opening starts a normal drill; passing through a due position reviews and
   reschedules it in place. No new session mode.
5. A one-time **backfill** seeds `drill_schedule` from the existing `drill_attempts` log.

**Key property:** a "review" *is* a first-try attempt, so `drill_schedule` is exactly an
incremental materialization of the attempts log. The same pure `scheduleReview` runs both the
live per-attempt upsert and the batch backfill, in `createdAt` order, so they produce identical
state — and the table can always be rebuilt from the immutable log if it ever drifts.

## 5. Data model

### `drill_schedule` (new) — one row per card `(epd, color)`

```ts
export const drillSchedule = sqliteTable(
  "drill_schedule",
  {
    epd:            text("epd").notNull(),            // position the user moves in
    color:          text("color").notNull(),         // side drilled — a card is (epd, color)
    openingEpd:     text("opening_epd"),             // most-recent opening context, for grouping "due"
    openingName:    text("opening_name"),
    easeFactor:     real("ease_factor").notNull(),   // SM-2 EF, starts 2.5, floor 1.3
    intervalDays:   integer("interval_days").notNull(),
    reps:           integer("reps").notNull(),        // consecutive successful reps
    dueAt:          integer("due_at").notNull(),      // epoch seconds; surfaces when dueAt <= now
    lastReviewedAt: integer("last_reviewed_at").notNull(),
    lastGrade:      integer("last_grade"),            // 0–5, for display/debug
  },
  (t) => ({
    pk:    primaryKey({ columns: [t.epd, t.color] }),
    byDue: index("drill_schedule_due_idx").on(t.dueAt),   // the "what's due" read
  })
);
```

`drill_attempts` is **unchanged** — it remains the immutable event log; `drill_schedule` is its
materialized SM-2 fold.

### Shared types (`shared/src/schemas.ts`)

```ts
export const DrillReason = z.enum(["leak", "due"]);   // was ["leak","failed","stale"]

// SM-2 state for one card; shared by the store and backfill.
export const CardState = z.object({
  easeFactor: z.number(),
  intervalDays: z.number().int(),
  reps: z.number().int(),
  dueAt: z.number().int(),
  lastReviewedAt: z.number().int(),
  lastGrade: z.number().int().nullable(),
});
export type CardState = z.infer<typeof CardState>;
```

`DrillRecommendation` keeps its existing shape; only the `reason` values change (`leak` / `due`).

## 6. The scheduler — `shared/src/srs.ts` (pure, test-first)

No `Date.now()`; time is passed in, matching `resultsStore` and the other shared modules.

```ts
export const EF_FLOOR = 1.3;
export const EF_START = 2.5;

/** Map a first-try drill outcome to an SM-2 quality grade 0–5.
 *  fail → 2 (a lapse, q<3); in-book pass with some loss → 4; best move (cpLoss 0) → 5. */
export function gradeFromDrill(a: { pass: boolean; cpLoss: number | null }): number {
  if (!a.pass) return 2;
  return a.cpLoss === 0 ? 5 : 4;
}

/** Advance one card's SM-2 state given a review grade. `prev` is null on the first-ever review. */
export function scheduleReview(prev: CardState | null, grade: number, reviewedAt: number): CardState {
  const efPrev = prev?.easeFactor ?? EF_START;
  const repsPrev = prev?.reps ?? 0;
  const intervalPrev = prev?.intervalDays ?? 0;

  // EF update (standard SM-2), floored.
  const ef = Math.max(EF_FLOOR, efPrev + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));

  let reps: number, intervalDays: number;
  if (grade >= 3) {                       // pass
    reps = repsPrev + 1;
    intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(intervalPrev * ef);
  } else {                                // lapse → relearn soon
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

- **Buckets are v1 defaults** (`fail→2`, `pass→4`, `best→5`), fixed for now.
- **Ungradable moves never reach here** — the drill already declines to record `cpLoss === null`
  attempts, so they are not reviews.

## 7. Query integration

### Write path — `scheduleStore.ts` + a loop in `resultsStore.ts`

```ts
// server/src/drill/scheduleStore.ts
import { and, eq, lte } from "drizzle-orm";
import { scheduleReview, gradeFromDrill, type DrillAttempt, type CardState } from "@coc/shared";
import { schema, type Db } from "../db/client.js";

/** Fold one first-try attempt into its (epd,color) card via SM-2: read prior state, advance,
 *  upsert. Used both per-attempt on save and per-row during backfill. */
export async function upsertCardReview(db: Db, a: DrillAttempt, reviewedAt: number): Promise<void> {
  const key = and(eq(schema.drillSchedule.epd, a.epd), eq(schema.drillSchedule.color, a.color));
  const prev = (await db.select().from(schema.drillSchedule).where(key))[0] ?? null;
  const next: CardState = scheduleReview(prev, gradeFromDrill(a), reviewedAt);
  await db.insert(schema.drillSchedule)
    .values({ epd: a.epd, color: a.color, openingEpd: a.openingEpd, openingName: a.openingName, ...next })
    .onConflictDoUpdate({
      target: [schema.drillSchedule.epd, schema.drillSchedule.color],
      set: { openingEpd: a.openingEpd, openingName: a.openingName, ...next },
    });
}
```

`saveDrillResults` adds one loop after its existing insert (same injected `createdAt`, so the
live path and backfill agree):

```ts
  const createdAt = now();
  await db.insert(schema.drillAttempts).values(/* …unchanged… */);
  for (const a of attempts) await upsertCardReview(db, a, createdAt);   // NEW
  return { saved: attempts.length };
```

### Read path — `recommendedQuery.ts` swaps `failed`+`stale` for `due`

The leak branch is untouched (top precedence, deduped by opening). The attempts-aggregation
block is replaced by a read of `drill_schedule` where `dueAt <= now`, grouped by opening.

```ts
const REASON_RANK: Record<DrillReason, number> = { leak: 0, due: 1 };   // was leak/failed/stale

export async function getDrillRecommendations(
  db: Db, leaks: Leak[], opts: { now: number; limit: number }
): Promise<DrillRecommendation[]> {
  const byEpd = new Map<string, DrillRecommendation>();

  // 1. Leaks — unchanged, highest precedence.
  for (const lk of leaks) {
    const epd = toEpd(lk.fenBefore);
    if (!byEpd.has(epd)) byEpd.set(epd, {
      openingEpd: epd, openingName: lk.openingName, eco: lk.eco,
      reason: "leak", score: lk.occurrences * lk.avgCpLoss, lastDrilled: null,
    });
  }

  // 2. Due cards → group by opening. An opening is "due" if it holds ≥1 card past its dueAt;
  //    score = number of due cards.
  const due = await db.select().from(schema.drillSchedule).where(lte(schema.drillSchedule.dueAt, opts.now));
  const catalog = new Map((await db.select().from(schema.openings)).map((o) => [o.epd, o]));
  interface DueAgg { name: string | null; count: number; last: number }
  const aggs = new Map<string, DueAgg>();
  for (const r of due) {
    if (!r.openingEpd) continue;
    const a = aggs.get(r.openingEpd) ?? { name: r.openingName, count: 0, last: -Infinity };
    a.count += 1;
    a.last = Math.max(a.last, r.lastReviewedAt);
    a.name = r.openingName ?? a.name;
    aggs.set(r.openingEpd, a);
  }
  for (const [openingEpd, a] of aggs) {
    if (byEpd.has(openingEpd)) continue;                 // a leak already covers this opening
    const cat = catalog.get(openingEpd);
    byEpd.set(openingEpd, {
      openingEpd, openingName: cat?.name ?? a.name ?? "Unknown opening", eco: cat?.eco ?? null,
      reason: "due", score: a.count, lastDrilled: a.last,
    });
  }

  return [...byEpd.values()]
    .sort((x, y) => REASON_RANK[x.reason] - REASON_RANK[y.reason] || y.score - x.score)
    .slice(0, opts.limit);
}
```

The signature drops `staleDays` (SM-2 owns spacing) and no longer reads `drill_attempts` — it
reads the materialized, `dueAt`-indexed `drill_schedule`. The `index.ts` wiring loses `staleDays`.

## 8. Session + UI

Deliberately tiny — session shape reuses the existing loop:

- **`useDrill` is unchanged.** It already posts first-try attempts at line end; the reschedule
  happens server-side inside `saveDrillResults`. Reviewing-in-passing falls out for free.
- **`drill.tsx`**: the reason chip renderer changes from `leak/failed/stale` to `leak/due`, each
  due row shows its `score` as an "N due" count, and a small header (e.g. "**12 positions due**",
  the sum of due counts) is included.

**Accepted limitation (line-based session):** because the opponent's replies are weighted-random,
reaching a *specific* overdue position on a given run is not guaranteed — the line may steer
elsewhere. Due cards simply remain due until a line passes through them. Steering the opponent
toward due positions is a future enhancement (§10), not v1.

## 9. Backfill, error handling, testing

### Backfill — one-time fold (`backfillSchedule.ts`)

Run as a db script (`npm run db:backfill-drill-schedule -w @coc/server`) after the migration:

```ts
/** Rebuild drill_schedule from scratch by replaying every drill_attempts row through SM-2 in
 *  chronological order. Idempotent: clears the table first, so it is safe to re-run to resync. */
export async function backfillSchedule(db: Db): Promise<{ cards: number }> {
  await db.delete(schema.drillSchedule);
  const rows = await db.select().from(schema.drillAttempts).orderBy(asc(schema.drillAttempts.id));
  for (const r of rows) {
    if (r.cpLoss === null) continue;                    // ungradable — never a review
    await upsertCardReview(db, r as DrillAttempt, r.createdAt);   // same fn as the live write path
  }
  return { cards: (await db.select().from(schema.drillSchedule)).length };
}
```

Because it reuses `upsertCardReview` with each row's own `createdAt`, the batch fold and the
incremental live path are the same function in the same order → identical state. This is the
safety net: if `drill_schedule` is ever suspected of drift, re-running reconstructs it from the
immutable log.

### Error handling & edge cases (per parent spec §10 — degrade, never silently swallow)

- **Ungradable attempts** (`cpLoss === null`) — skipped everywhere; never reviews.
- **One review per position per session** — `useDrill` records first-try only once per `epd`
  (its `recordedRef`), so SM-2 gets exactly one review per card per session, as it expects.
- **Both colors** — `(epd, color)` keying makes a position drilled from white vs black two
  independent cards; intentional.
- **Schedule upsert failure mid-batch** — the session already happened; retry once, else surface
  the existing non-blocking "couldn't save progress" banner. The attempts log still persisted, so
  a later **backfill re-run** recovers the schedule. No corruption (idempotent rebuild).
- **Leak ⇄ due overlap** — an opening that is both a leak and has due cards shows once, as `leak`
  (top precedence) — the existing dedup-by-opening.
- **Determinism** — all timestamps injected; no `Date.now()` in shared or test paths.

### Testing strategy (Vitest; TDD for pure math, fixtures for I/O)

**Pure unit (test-first):**
- **`srs.ts`** — `scheduleReview`: first pass → interval 1; second → 6; third → `round(6·EF)`; a
  lapse resets `reps→0`, `interval→1`; EF floored at 1.3 after repeated lapses;
  `dueAt = reviewedAt + interval·86400`. `gradeFromDrill`: fail→2, pass→4, best (cpLoss 0)→5.
- **Store ⇄ backfill parity** — folding a sequence incrementally (per-attempt `upsertCardReview`)
  equals folding it as one backfill pass → identical `CardState`. Locks the shared-function guarantee.

**Server integration (temp in-memory SQLite + seeded rows):**
- `saveDrillResults` writes attempts **and** advances the schedule (insert then a second call updates it).
- `backfillSchedule` over a seeded `drill_attempts` log → expected per-`(epd,color)` `CardState`;
  idempotent on re-run.
- `getDrillRecommendations` — `leak > due` ordering, due openings ranked by due-card count, and
  recently-reviewed (not-yet-due) openings omitted.

**Frontend component (jsdom + mocked RPC):**
- `drill.tsx` renders `leak`/`due` chips and the "N due" count; `useDrill` unchanged path still
  posts attempts and completes.

**Not automated** (matches the README's deferred/manual note): a real multi-day drill against the
live book + engine to confirm the intervals feel right.

## 10. Open questions / future

- **Grade-bucket tuning** — the `2/4/5` mapping and EF constants are fixed v1 defaults; expose as
  settings once there is real usage data, alongside the existing `maxCpLoss`.
- **Opponent steering toward due cards** — bias the weighted opponent pick toward branches that
  contain the user's most-overdue positions, so a review session reliably hits what is due. The
  clean end state; deferred to keep v1 small.
- **Richer grades from retry count** — capturing how many retries a miss took would allow a finer
  quality grade (e.g. distinguishing a near-miss from flailing); the drill currently records
  first-try only.
- **"Due today" surfacing** — a dashboard badge / count of positions due, beyond the drill page.

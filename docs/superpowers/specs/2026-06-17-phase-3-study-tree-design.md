# Phase 3 — Study + Tree (browse) Design Spec

**Date:** 2026-06-17
**Status:** Approved design, ready for implementation planning
**Builds on:** Phase 1 (leak report) + Phase 2 (per-game Review). See
`2026-06-15-chess-opening-coach-design.md` (§9 Views, §8 endpoints) and
`2026-06-17-phase-2-per-game-review-design.md` (the `ReviewWorkspace` pattern this
mirrors).

## 1. Goal

Add the two remaining browse views from the design's §9, over a single shared
`ExplorerWorkspace`:

- **Tree** (`/tree`) — navigate the opening positions from *your own games* as a
  lazy, per-position explorer (a repertoire navigator), scoped by color.
- **Study** (`/study`) — pick an opening and browse its theory: live Lichess book
  stats (masters / rating), Stockfish eval (cached automatically, on-demand via an
  **Analyze** button), and free board play to walk any legal line. Reachable via
  **"Study this position"** deep-links from a leak row and from the Tree.

Both reuse the existing `Chessboard`, `EvalBar`, `ClassificationChip`, the
`getBook` book cache, and the `position_evals` eval cache. All eval values shown in
the UI are **White-POV centipawns**, reusing Phase 2's `whitePovCp` convention.

## 2. Scope

**In scope**
- Shared, presentational `ExplorerWorkspace` + `ExplorerMoveTable` components.
- `Tree` view: per-position navigator over your games, color-scoped, pure cached
  reads.
- `Study` view: opening picker, live book + cached eval, on-demand Analyze, free
  board play.
- `"Study this position"` deep-links from the leak detail and from Tree rows.
- Four new backend routes + services; new `@coc/shared` schemas.
- `Tree` and `Study` nav entries.

**Out of scope (YAGNI)**
- lichess `GameSource` adapter (still chess.com only).
- Graphical tree "map" (design defers it; the explorer navigator is the Tree).
- Settings screen.
- FEN/PGN paste entry (deep-links pass an `epd` via the route, but there is no
  user-facing paste field).
- On-demand engine *interleaving/preemption* with a running sync (we reject with
  409 instead).

## 3. Architecture

Approach: **one shared presentational `ExplorerWorkspace` + thin `StudyPage` /
`TreePage` route wrappers**, with **lazy per-position backend endpoints**. This
mirrors the proven Phase 2 split (`ReviewWorkspace` + thin route components):
pure components are unit-tested router-free; pages wire data + navigation. Lazy
per-position data scales to large repertoires and arbitrary book lines without
shipping a whole tree.

The two views differ only in the *data* fed to the workspace and two injected
slots (`controls`, `detail`):

| | Tree | Study |
|---|---|---|
| Move rows | your played moves (count, W/D/L, classification, avg cp-loss) | book moves (count, W/D/L) |
| Eval | cached only | cached + on-demand Analyze |
| Board input | navigate rows only | rows **+ free legal moves** |
| `controls` slot | color toggle | masters/rating source toggle |
| `detail` slot | (move summary) | engine lines + Analyze button |
| Data source | `moves` + `games` (cached) | `getBook` (live) + `position_evals` |

## 4. Data model

**No migrations.** Everything reuses existing tables:

- `openings(epd PK, eco, name)` — Study picker source.
- `book_stats(epd, source, …)` via `getBook(db, epd, source)` — already supports
  both `masters` and `rating` with caching + timeout.
- `position_evals(epd, depth, engineVersion, scoreCp, mateIn, linesJson)`,
  PK `(epd, depth, engineVersion)` — cached eval reads and the on-demand Analyze
  write.
- `moves(… epdBefore, epdAfter, san, uci, isMine, classification, cpLoss …)` with
  the existing `moves_epd_before_idx`, joined to `games(myColor, result, …)` —
  Tree aggregation.

A position is identified by its **EPD** (4-field FEN); a full board FEN is
`${epd} 0 1` (as `explorerClient` already does).

## 5. Backend: routes + services

All routes hang off the existing Hono app; each is backed by a small pure service
and a new `AppDeps` entry, wired in `index.ts` by closures over `db`, `engine`,
`DEPTH`, `MULTIPV`, `engineVersion()`, and `getActiveRunId` (the Phase-1 guard
dependency, already present).

| Route | Service | Behavior |
|---|---|---|
| `GET /openings?q=` | `searchOpenings(db, q)` | `openings` filtered by `name`/`eco` `LIKE`, ordered, limit ~50 → `OpeningListItem[]`. Powers the picker. |
| `GET /explore?epd=&source=` | `getExplore(db, epd, source)` | `getBook()` (live + cached) **+** the *cached-only* `position_evals` row for `(epd, DEPTH, engineVersion)` → White-POV eval + lines. **No engine call.** Auto-fetched on every Study position. |
| `GET /position?fen=` | `analyzeOnDemand(db, analyzer, opts, fen)` | **If `getActiveRunId() != null` → 409** ("engine busy: sync in progress"). Else ensure the engine is started, short-circuit on a cache hit, otherwise `engine.analyze(fen, DEPTH, MULTIPV)`, upsert `position_evals`, return White-POV eval + lines → `PositionAnalysis`. The Analyze button. |
| `GET /tree?color=&epd=` | `getTreeChildren(db, color, epd?)` | Moves from *your games of `color`* with `epd_before = epd` (default = start-position EPD), grouped by `san`/`uci`: `count`, W/D/L from **your** POV (from `games.result` + `color`), `isMine`, the move's `classification`, avg `cpLoss`. Pure cached reads via `moves_epd_before_idx` → `TreeChildren`. |

`analyzeOnDemand` reuses the analysis orchestrator's row-shaping (the same
`(epd, depth, engineVersion)` key and `linesJson` layout) so an on-demand eval is
byte-identical to a sync-produced one and the two share the cache transparently.

**Engine concurrency.** The single long-lived Stockfish process is shared with
sync. `/position` rejects with 409 while a sync run is active (no interleaving);
otherwise the engine manager serializes one analysis at a time. Starting the
engine on the first Analyze (outside a sync) is allowed.

## 6. Shared schemas (`@coc/shared`)

New Zod schemas + inferred types, validated at the web boundary (mirroring `Leak`
/ `GameReview`). Reuse existing `EngineLine`, `Classification`, `Color`.

- `BookSource = z.enum(["masters", "rating"])`
- `OpeningListItem { epd, eco, name }`
- `BookMoveStat { san, uci, count, white, draws, black }`
- `ExploreResult { epd, source, total, bookMoves: BookMoveStat[], evalWhiteCp: number | null, lines: EngineLine[] }`
- `PositionAnalysis { epd, evalWhiteCp: number | null, scoreCp: number | null, mateIn: number | null, lines: EngineLine[], depth, engineVersion }`
- `TreeChild { san, uci, epdAfter, count, isMine, classification: Classification | null, avgCpLoss: number | null, white, draws, black }`
- `TreeChildren { epd, color: Color, children: TreeChild[] }`

## 7. Frontend

**`ExplorerWorkspace` (new, pure/presentational)** — the shared foundation,
unit-tested router-free. Props:
- `fen`, `evalWhiteCp`, optional board `arrows`;
- `moves`: unified rows `{ san, uci, count, white, draws, black, isMine?, classification?, avgCpLoss? }`, rendered by **`ExplorerMoveTable`** (W/D/L bar + count, optional `ClassificationChip`), each row clickable → `onSelectMove(uci)`;
- `path` (breadcrumb of SANs) + `onNavigate(index)` / back / reset;
- `allowFreeMove` + `onPlayMove(uci)` — chessground move input (Study only);
- `controls` and `detail` slots (`ReactNode`) for per-view bits.

**`ExplorerMoveTable` (new, pure)** — renders the unified move rows; used by both
views.

**`StudyPage` (`/study`)** — if `?epd=` is present (deep-link) it loads that
position; otherwise it shows **`OpeningPicker`** (debounced search → `GET /openings?q=`
→ pick sets the studied root). Holds the line as a **`chess.js` game seeded from
the opening's FEN** (`${epd} 0 1`); each position auto-fetches `GET /explore` with a
masters/rating **source toggle** in the `controls` slot. The `detail` slot shows
engine lines if cached plus an **Analyze** button → `GET /position` (disabled with a
tooltip on 409). Clicking a book move **and** dragging a legal piece both push a
move onto the line; back/reset navigate.

**`TreePage` (`/tree`)** — a **color toggle** (white/black) in the `controls` slot;
a navigation path from the start position; each position fetches
`GET /tree?color=&epd=`; clicking a child descends (to its `epdAfter`), back pops.
No free play, no Analyze. Each row carries a **"Study this position"** link →
`/study?epd=…`.

**Deep-links & nav** — add "Study this position" to the leak detail
(`ExplorerLines`); add **Tree** and **Study** to the `AppShell` nav (Settings
stays out of scope); register `/tree` and `/study` in the router (`/study`
`validateSearch` for `epd` + `source`). `whitePovCp` evals flow straight into
`EvalBar`.

## 8. Error handling & edge cases

- **`/position` during sync →** 409; Study disables Analyze with a tooltip. Engine
  analyze failure/timeout → "Analysis failed — try again"; book + cached eval
  remain.
- **Book lookup fails** (Lichess 429/down) → `/explore` still returns the cached
  eval; `bookMoves: []`, `total: 0`; UI shows "book unavailable" rather than
  erroring (matches the design's graceful-degrade rule).
- **Invalid `epd`/`fen`** → 400 (Zod query validation).
- **Study deep-link to an unnamed position** → still loads; the line/position is
  shown without requiring an `openings` row.
- **Tree leaf** (no games continue) → empty-state ("No games continue past this
  position").
- **Empty/short picker query** → debounced; returns top matches or an empty list.
- **Illegal free move** → chessground rejects it (no-op); the `chess.js` game is
  the source of truth for legality.

## 9. Testing strategy

Vitest + Testing Library; TDD for pure logic; mirrors Phase 2.

- **Server (in-memory DB, fake analyzer — no real binary):** `searchOpenings`
  (name/eco match, limit); `getTreeChildren` (aggregation, color scoping, W/D/L
  from your POV, `isMine`/classification, empty leaf); `getExplore` (book + cached
  eval shaping, White-POV, missing-eval → null); `analyzeOnDemand` (cache hit
  short-circuits; miss runs the analyzer + upserts; row identical to sync's);
  route tests for `/openings`, `/explore`, `/tree`, and `/position` **including the
  409-when-active-run path**.
- **Web (router-free pure components; pages mock the api client):**
  `ExplorerMoveTable`, `ExplorerWorkspace` (board/eval/table render, select +
  free-move callbacks, breadcrumb nav), `OpeningPicker` (search → list → select),
  `StudyPage` (explore load, Analyze → `/position`, free play advances the line,
  source toggle), `TreePage` (color toggle, descend/back, "Study this" link), and
  the leak-row deep-link.
- **Close:** full suites + `tsc -p server/tsconfig.json --noEmit` +
  `tsc -p web/tsconfig.json --noEmit` + `vite build` all clean. (Note: neither
  `vitest` nor the web `build` typechecks — the explicit `tsc` runs are required.)

## 10. Open questions

None blocking. Defaults chosen and locked above:
- Tree root is the standard start position; color scoping selects games by
  `my_color`.
- Study line is a `chess.js` game seeded from the opening's FEN; free play is
  validated by `chess.js`.
- On-demand engine rejects (409) during sync rather than interleaving.

# Phase 2 (first cycle) — Per-game Review — Design Spec

**Date:** 2026-06-17
**Status:** Approved design, ready for implementation planning
**Parent spec:** `2026-06-15-chess-opening-coach-design.md` (§9.3, §12 Phase 2)

## 1. Overview

The original Phase 2 bundled three independent features — per-game **Review**, a
repertoire **Tree** explorer, and the **lichess** adapter. That bundle is too large
for one clean spec/plan cycle, so we decompose it. **This spec covers only the first
cycle: the Games list + per-game Review screen.** Tree, lichess, and Study become
their own later spec/plan cycles.

Review lets the user open a single imported game and step through its **opening
phase** on a board, seeing each move's Stockfish verdict, book status, engine lines,
the better move, and an eval graph — the same per-position signals the leak report
aggregates, but for one concrete game. It also closes the loop from the leak report:
a leak's "games it happened in" deep-link straight into Review at the offending move.

Single user, runs locally. Consistent with the parent spec's decisions (no new
frameworks, no new external services).

## 2. Goals / Non-goals

**Goals**
- A **Games list** view: filterable/sortable table of imported games → open Review.
- A per-game **Review** screen scoped to the **opening phase**, rendering entirely
  from already-cached data (no new engine work):
  - board step-through with last-move highlight;
  - move list with classification chips (current-move highlight, click-to-jump);
  - eval bar + a clickable eval graph (sparkline) across opening plies;
  - engine PV lines + book stats for the current position.
- Close the **leak → game loop**: leak detail lists the games where the leak
  occurred, each deep-linking into Review pre-positioned at the offending ply.

**Non-goals (this cycle)**
- Repertoire **Tree** explorer (next cycle).
- **lichess** adapter / second game source (next cycle).
- **Study** browse mode (later).
- On-demand `GET /position?fen=` single-position analysis (belongs to the Tree
  cycle, which explores positions ad-hoc).
- Analyzing or reviewing moves **beyond the opening phase** — the app only stores
  and analyzes opening plies; Review covers exactly those.

## 3. Key decisions (locked)

| Area | Decision |
| --- | --- |
| Review coverage | **Opening phase only** — exactly the plies stored in `moves`. No new engine work; Review is pure cached reads. |
| Data delivery | **One enriched `GameReview` payload** from `GET /games/:id` (server-side DB joins). Not lazy per-position fetching. |
| Eval graph | **Dependency-free inline SVG sparkline** (≤~30 points), clickable to jump. No charting library. |
| Games list filtering | **Client-side** filter/sort (single user, hundreds of rows). `GET /games` returns all. |
| Leak occurrences | New lazy endpoint, fetched when a leak row expands. Not embedded in the `/leaks` payload. |
| Boundaries | Shared Zod schemas for games/review (replacing the loose TS interfaces in `routes/app.ts`), matching how `Leak` is already validated at the client boundary. |
| Workspace reuse | `ReviewWorkspace` built with clean boundaries so Tree/Study can reuse it later — but **not** abstracted for those phases now (YAGNI). |

## 4. Backend (`server/`)

All Review data is already cached in SQLite (`position_evals`, `book_stats`,
`moves`), so the backend work is querying and shaping, not analysis.

### 4.1 Enrich `GET /games/:id` → `GameReview`
Returns game metadata + a fully-enriched `moves[]`. Each move row (already carrying
`classification`, `cpLoss`, `bookStatus`, `evalPlayedCp`, `evalBestCp`) is joined
with:
- `position_evals` (keyed by `epdBefore`, at the run's `depth` + `engineVersion`) →
  the engine **PV lines** (parsed from `linesJson`) for that position;
- `book_stats` (keyed by `epdBefore`, `source = 'masters'`) → book moves/stats;
- the derived **better-move SAN** for the position.

The better-move derivation currently lives in `leaksQuery.ts` as `bestSanFor`.
Extract it to a shared helper (e.g. `server/src/analysis/bestMove.ts`) and call it
from both `leaksQuery` and the new game-review query — no behavior change to leaks.

### 4.2 Extend `GET /games`
Add `myColor` (and ratings) to the summary so the list can display and filter by
color. Returns all games; ordering/filtering happens client-side.

### 4.3 New `GET /leaks/occurrences?epd=&san=`
Given a leak's group key (`epdBefore`, the user's `san`), return the concrete
occurrences: `[{ gameId, ply, result, endTime, openingName, myColor }]` — the moves
rows matching that key where `is_mine = 1`. Powers the leak-detail games list **and**
supplies the deep-link target `ply`.

## 5. Shared schemas (`shared/`)

Add Zod schemas (validated at the client boundary, like `Leak`):
- `GameSummary` — list row: id, openingName, eco, result, timeClass, endTime,
  myColor, myRating, oppRating.
- `ReviewMove` — one enriched opening ply: ply, san, uci, isMine, fenBefore,
  fenAfter, bookStatus, classification, cpLoss, evalPlayedCp, evalBestCp,
  engineLines (`EngineLine[]`), betterMoveSan, bookMoves/bookTotal.
- `GameReview` — game metadata + `ReviewMove[]`.
- `LeakOccurrence` — `{ gameId, ply, result, endTime, openingName, myColor }`.

This replaces the loose `GameSummary`/`GameDetail` TS interfaces in
`routes/app.ts` and removes the `as Leak[]`-style casts in the web client for these
payloads.

## 6. Frontend (`web/`)

### 6.1 Routes & nav
- `/games` — Games list page.
- `/games/$id` — Review page; reads an optional `?ply=N` search param to seed the
  initial position (for leak deep-links).
- Add **Games** to the `AppShell` sidebar nav.

### 6.2 Games list page
Filterable/sortable table over the `/games` payload: filter by color, result, time
class, and an opening-name text search; sortable columns. Row click → `/games/$id`.

### 6.3 `ReviewWorkspace`
Composed view with clean internal boundaries (so Tree/Study can reuse it later):
- center **`Chessboard`** (existing chessground wrapper) showing the current ply's
  position, with last-move highlight;
- side **`EvalBar`** (existing) bound to the current position's eval;
- **`MoveList`** (new) — opening moves with `ClassificationChip`s, current-move
  highlight, click-to-jump;
- **`EvalGraph`** (new) — inline **SVG sparkline** of eval across opening plies;
  click a point to jump to that ply. No charting dependency. The line is plotted
  from a **single consistent perspective (White's POV)** and clamped to a sane cp
  range so it doesn't zig-zag by side-to-move;
- **`PositionPanel`** (new) — engine PV lines + book stats for the current position.
  Note: there is **no** existing panel to reuse. `ExplorerLines.tsx` today contains
  only `LeakDetail` (a board + text summary; it does not render a PV or book table).
  `PositionPanel` renders **from the embedded `ReviewMove` data** (engine lines +
  book stats already in the `GameReview` payload) — it does **not** re-fetch, keeping
  the decision-A "one payload, no further fetches" property.

**Navigation state:** a single current-ply index owned by `ReviewWorkspace`.
←/→ step, Home/End jump to ends; clicking a move row or a graph point sets the index.
`?ply=` seeds the initial index. Board renders the position *after* the current ply
(start position before ply 1) and highlights that move.

### 6.4 New shared component: `ClassificationChip`
Small colored chip mapping `Classification` (`best`/`book`/`inaccuracy`/`mistake`/
`blunder`) + `BookStatus` to label/color. Used by `MoveList`. Optionally retrofit
into the Leaks table later for consistency — **out of scope here** unless trivial.

### 6.5 Leak → Review deep-link
`LeakDetail` (in `ExplorerLines.tsx`) lazily fetches `/leaks/occurrences` when a leak
row expands (it already expands on click), renders the list of games it happened in,
each row linking to `/games/$id?ply=N`.

## 7. Testing strategy

Follows the parent spec's approach (Vitest + Testing Library; TDD for pure logic).

- **Server:**
  - enriched game-review query over a fixture DB → asserts each move carries its
    engine lines, book stats, and derived better-move;
  - `/leaks/occurrences` query → returns the right games/plies for a known leak key;
  - extracted `bestMove` helper keeps `leaksQuery` output unchanged (existing
    `app.leaks.test.ts` / `leaksQuery.test.ts` still pass).
- **Web (component/integration):**
  - `MoveList` — chips reflect classification, current move highlighted, click jumps;
  - `EvalGraph` — renders a point per ply, click jumps to that ply;
  - Review page — loads a `GameReview`, ←/→ stepping moves the board and updates the
    eval bar + graph selection; `?ply=` seeds position;
  - Games list — filter + sort behavior;
  - Leak deep-link — expanding a leak fetches occurrences and renders working links.

## 8. Error handling & edge cases

- **Missing enrichment:** a position with no cached eval (e.g. an analysis gap) →
  the move renders with available fields and an empty engine-lines panel rather than
  failing the whole Review. Book "unknown" already handled upstream.
- **`/games/:id` not found** → 404 (existing behavior preserved).
- **Deep-link `?ply` out of range / non-numeric** → clamp to a valid index (default
  to the start) instead of throwing.
- **Game with no analyzed opening moves** (skipped/abandoned) → Games list still
  shows the row; Review shows an empty-state message instead of a broken board.

## 9. Out of scope (explicit — own later cycles)

Repertoire **Tree**; **lichess** adapter; **Study**; `GET /position?fen=` on-demand
analysis; any analysis of moves beyond the opening phase; retrofitting
`ClassificationChip` into the existing Leaks table (optional, deferred).

## 10. Pre-step

The working tree currently holds **uncommitted Phase 1 robustness fixes**
(concurrency guard, resumable progress counter, book-fetch timeout). Commit those
first so this cycle starts from a clean tree.

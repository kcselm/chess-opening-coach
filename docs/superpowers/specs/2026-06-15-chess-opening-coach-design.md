# Chess Opening Coach — Design Spec

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation planning
**Working name:** `chess-opening-coach` (rename freely)

## 1. Overview

A personal, local web app that pulls the user's online games (chess.com and
lichess), analyzes the **opening phase** of each game with a native **Stockfish**
engine cross-referenced against **Lichess opening book** data, and surfaces
recurring opening mistakes. Think openingtree.com, but every move is annotated
with Stockfish's verdict, and the headline output is a prioritized "leak report"
of the opening errors that cost the user the most.

Single user, runs locally, no accounts, no hosting.

## 2. Goals / Non-goals

**Goals**
- Import games from chess.com **and** lichess by username.
- Analyze opening moves with native Stockfish, cached by position.
- Classify each of the user's opening moves using a **layered** definition of
  "mistake": book status (vs a reference DB) **and** engine eval loss — both
  signals always visible.
- Four views over the same data: **Leak report**, **repertoire Tree**,
  **per-game Review**, **Study** (browse an opening's theory).

**Non-goals (now)**
- Multi-user / hosting / auth.
- Chess variants (chess960, crazyhouse, etc.) — standard chess only.
- Drilling / spaced-repetition (deferred to Phase 4).
- Real-time over-the-board analysis.

## 3. Key decisions (locked)

| Area | Decision |
| --- | --- |
| Deployment | Personal, local, single-user web app |
| Frontend | React + Vite + TanStack Query + TanStack Router + Zod |
| Backend | Node + Hono (typed RPC client) + Drizzle + SQLite |
| Engine | Native Stockfish binary as a long-lived child process over UCI |
| Board UI | `chessground` (Lichess board — best arrows/annotations) |
| Chess logic | `chess.js` (standard chess; variants out of scope) |
| Sources | chess.com + lichess via a `GameSource` adapter interface |
| Book reference | Lichess Opening Explorer (`masters` + `my rating`, toggle) |
| Mistake definition | Layered: out-of-book **and** eval loss; both signals shown |
| Leaks | A query (not a table): group by position-before-my-move |
| Caching | By FEN — analyze each unique position once |
| Testing | Vitest + Testing Library; TDD for pure logic |

## 4. Architecture

One repo, two processes in dev (Vite proxies API calls to Hono); in production
Hono serves the built frontend.

```
/web      React + Vite + TanStack + Zod (chessground board)
/server   Hono + Drizzle/SQLite, Stockfish child process, source adapters
/shared   Zod schemas + types shared by client and server
```

The backend fully owns the long-lived Stockfish process and the in-process
analysis queue — the reason we chose a server we control rather than a
serverless/RSC framework.

## 5. Data model (SQLite + Drizzle)

```
games          — id (source url), source, username, my_color, result, time_class,
                 end_time, eco, opening_name, my_rating, opp_rating, pgn
moves          — game_id, ply, fen_before, fen_after, san, uci, is_mine,
                 book_status, eval_before_cp, eval_after_cp, cp_loss, classification
position_evals — fen (key), depth, score_cp/mate, best_moves[multiPV], engine_ver   ← Stockfish cache
book_stats     — fen + source(masters|rating), total, moves[{san,count,w/d/l}]       ← Lichess cache
openings       — eco, name, pgn/epd   (seeded once from Lichess's openings dataset)
```

- **Dedup by FEN:** opening positions repeat across hundreds of games, so
  `position_evals` and `book_stats` are keyed by FEN and computed once.
- **Leaks are a query**, not a table: `GROUP BY` the position *before* the
  user's move + opening name, ranked by `occurrences × avg(cp_loss)`. Always live.
- Every cached eval stores `engine_ver` + `depth`; changing engine settings
  produces a new cache key rather than reusing stale data.

## 6. Analysis pipeline (one "sync" run)

1. **Fetch** via the selected `GameSource` adapter → upsert new `games`
   (skip already-imported by `source` + id).
2. **Replay** each game's PGN with `chess.js`, but only the **opening phase**:
   continue until both sides are ~1 move out of book, capped at ~ply 30
   (configurable). Record fen/san/uci per ply; flag the user's moves.
3. **Name** the opening by longest match against `openings`.
4. For each **unique, uncached** position: Lichess book lookup (masters + rating)
   + Stockfish MultiPV analysis → fill the two cache tables.
5. **Classify** each of the user's moves (see §7) → write `moves` rows.
6. **Progress** streamed over SSE throughout; run marked complete. Runs are
   **resumable and idempotent** (cache + run state); cancellation sends UCI
   `stop` + a DELETE.

### GameSource adapter

```ts
interface GameSource {
  id: 'chesscom' | 'lichess'
  fetchGames(username, { since, until, timeClasses }): AsyncIterable<NormalizedGame>
}
```

- **chess.com:** monthly archive endpoints, JSON with embedded PGN, no auth.
- **lichess:** streaming `/api/games/user/{name}` (NDJSON/PGN), rich filters,
  no auth (optional token raises rate limits).

Each adapter normalizes its quirks (my color, ratings, time-class names, result
encoding, ids) into one `NormalizedGame`. Everything downstream is source-agnostic.

## 7. Classification (the "mistake" definition)

For each of the user's opening moves, using the cached eval + book stats for the
position *before* the move:

- **Book status:** is the move among the reference moves, and how popular?
  Out-of-reference = **novelty** (not inherently bad).
- **cp_loss:** `eval(best move) − eval(played move)`, from the user's perspective.
- **Label** (defaults, all configurable): `book` / `best`,
  `inaccuracy ≥ 50cp`, `mistake ≥ 100cp`, `blunder ≥ 200cp`.
- A move counts as a leak when it is **out of book AND** loses eval beyond
  threshold — but the UI always shows both signals independently.

**Engine defaults (configurable):** depth ~18–20, MultiPV 3, Threads = cores−1,
Hash tunable.

## 8. Backend components

- **HTTP layer (Hono + Zod):** routes exported as a typed RPC client.
  `POST /sync`, `GET /sync/:id/progress` (SSE), `GET /leaks`, `GET /games` +
  `/games/:id`, `GET /tree`, `GET /explore?fen=` + `/study`,
  `GET /position?fen=` (on-demand single-position analysis).
- **GameSource adapters** (`chesscom`, `lichess`).
- **Ingest service** — fetch, upsert, replay, opening-phase extraction.
- **Opening namer** — longest-match against `openings`.
- **Engine manager** — spawns `stockfish` **once**, speaks UCI, exposed as
  `analyze(fen, { depth, multipv }) → EvalResult`; supervised with per-position
  timeout + restart + re-queue.
- **Book client** — Lichess Opening Explorer, cached, polite sequential calls
  with backoff; degrades gracefully (engine eval with book "unknown" on failure).
- **Analysis orchestrator** — in-process queue over the run's unique uncached FENs.
- **Classifier** — §7.
- **Persistence** — Drizzle repositories; FEN-keyed cache lookups.

## 9. Frontend

- **Shell:** left **sidebar** nav — Dashboard, Leaks, Tree, Games, Study,
  Settings — with a sync-status indicator.
- **Routing:** TanStack Router. **Data:** TanStack Query over the typed Hono RPC
  client, Zod-validated at the boundary.
- **Shared components:** `<Chessboard>` (chessground wrapper), `<EvalBar>`,
  `<ExplorerTable>`, classification chips, `<OpeningBreadcrumb>`,
  `<SyncProgress>` (SSE consumer).
- **Views:**
  1. **Leaks** — ranked **table** (sortable: opening + line, your move → better,
     occurrences, avg loss, score) with **row-expands-to-detail** (board, engine
     lines, the games it happened in).
  2. **Tree** — **explorer-table navigator** + board + controls
     (color / source / reference toggle / depth). Optional graphical "map" later.
  3. **Games** — filterable list → per-game **Review** reusing the workspace,
     with an opening eval-graph and step-through classification.
  4. **Study** — opening picker → workspace over masters + our eval; browse lines.
- **Dashboard/Sync** — username + sources + date range + time-class form →
  start sync → live progress → summary stats.

## 10. Error handling & edge cases

- **External APIs:** rate limits (429 → backoff, respect `Retry-After`);
  username-not-found and private/missing months surfaced clearly; lichess
  streaming resumes via `since`; Opening Explorer cached aggressively and
  **degrades gracefully** (book "unknown" rather than failing).
- **Stockfish:** missing/wrong-platform binary detected at startup with setup
  instructions; per-position timeout + supervised restart + re-queue; mark failed
  after N retries; evals stamped with `engine_ver` + `depth`.
- **Data/PGN:** skip non-standard variants and abandoned/no-move games with a log
  entry; openings missing from the names table labeled "unknown" but still analyzed.
- **Sync robustness:** resumable + idempotent; per-item failures don't kill the
  run — collected into a **run report** the UI shows. No silent swallowing.

## 11. Testing strategy

- **Tooling:** Vitest (server + web) + Testing Library; optional Playwright later.
  TDD for pure logic; UI + engine integration tested after.
- **Unit (test-first):** classifier, UCI parser (against captured engine output),
  GameSource adapters (recorded fixtures), PGN replay + opening-phase boundary,
  opening namer.
- **Integration:** engine manager vs the real binary (known position, flag-gated);
  full pipeline over fixture PGNs → temp SQLite → leak query; Hono routes with
  fixture-backed services.
- **Frontend:** component tests for ExplorerTable, chips, leak-table sort/expand.
- **Determinism:** record real API responses once as fixtures; DB tests use temp
  SQLite.

## 12. Phasing

- **Phase 0 — Walking skeleton:** monorepo + shared Zod schemas, Drizzle/SQLite,
  **engine manager analyzing one FEN end-to-end**, chess.com adapter + ingest,
  minimal sync + SSE. *Proves the two riskiest integrations (native Stockfish UCI
  + external fetch) first.*
- **Phase 1 — Leak report (MVP, the headline):** book client + cache, opening
  namer, classifier, leaks query, ranked table + expandable detail UI,
  Dashboard/Sync.
- **Phase 2 — Tree + per-game Review:** explorer workspace, repertoire tree with
  controls, games list + review; add the **lichess** adapter.
- **Phase 3 — Study (browse):** opening picker + study workspace.
- **Phase 4 (later) — Drilling:** spaced-repetition practice on weak lines.

**MVP boundary for the first implementation plan: Phase 0 + Phase 1** (leak
report from chess.com games). Later phases become their own spec/plan cycles.

## 13. Open questions / future

- Exact cp_loss thresholds and opening-phase boundary defaults to be tuned with
  real data (all configurable from the start).
- Optional fast-path: reuse lichess's own eval/opening data for already-analyzed
  games (deferred; we run our own engine for consistency).
- Optional graphical repertoire "map" view alongside the explorer table.
- Possible later packaging as a Tauri/Electron desktop app (wrap, don't rewrite).

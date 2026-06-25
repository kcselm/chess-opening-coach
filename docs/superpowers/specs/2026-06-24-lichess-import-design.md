# Lichess Import — Design Spec

**Date:** 2026-06-24
**Status:** Approved design, ready for implementation planning
**Parent spec:** `2026-06-15-chess-opening-coach-design.md` (Phase 2 named the lichess
adapter; it was deferred and is delivered here)

## 1. Overview

Add Lichess as a second game source alongside chess.com. The app's ingest,
analysis, classification, and leak/tree/review/study/drill features are already
source-agnostic — they consume `NormalizedGame` through the `GameSource`
adapter interface. This work fills in the one missing adapter and the minimal UI
to select it.

## 2. Goals / Non-goals

**Goals**
- Import a user's standard-chess games from Lichess by username.
- Normalize Lichess's game JSON into the existing `NormalizedGame` shape so every
  downstream feature works unchanged.
- Let the user choose chess.com vs. Lichess from the Dashboard before syncing.

**Non-goals (now)**
- A fuller sync form (date-range picker, time-class checkboxes). Deferred; the
  Dashboard gains only a source toggle and keeps the current hardcoded 90-day
  window and default time classes.
- Reusing Lichess's own engine evals / opening names as a fast path (spec defers
  this — we run our own engine for consistency).
- Chess variants (chess960, etc.) — standard chess only, matching the chess.com
  adapter and the parent spec's non-goals.

## 3. The seam (why this is small)

Three things are already source-agnostic and need **no** change:
- `GameSource` interface (`server/src/sources/types.ts`) already declares
  `id: "chesscom" | "lichess"`.
- `NormalizedGame.source` and `GameSummary.source` (`shared/src/schemas.ts`)
  already allow `"lichess"`.
- Ingest (`server/src/ingest/ingestService.ts`) consumes any `GameSource`.

So the change is: one schema enum widen, one new adapter file, one source-pick at
the call site, and one UI toggle.

## 4. Changes

### 4.1 Schema (`shared/src/schemas.ts`)
- `SyncRequest.source`: `z.enum(["chesscom"])` → `z.enum(["chesscom", "lichess"])`.
  Remove the "lichess source lands in Phase 2; MVP syncs chess.com only" comment.
- `TimeClass` enum unchanged (`bullet/blitz/rapid/classical/daily`).

### 4.2 Adapter (`server/src/sources/lichess.ts`)
Mirrors `chesscom.ts`'s shape: an exported **pure** `normalizeLichessGames(...)`
function (unit-testable off a recorded fixture) plus a thin `LichessSource` class
that does the network fetch and delegates mapping.

- **Endpoint:** `GET https://lichess.org/api/games/user/{username}` with
  `Accept: application/x-ndjson`, streamed **line-by-line** (one game JSON per
  line) so a long game history is not buffered whole.
- **Query params:**
  - `since` / `until` — epoch **milliseconds**. The internal `FetchParams` uses
    **seconds** (chess.com convention), so the adapter multiplies by 1000.
  - `pgnInJson=true` — each game object carries a `pgn` string field.
  - `perfType` — comma list, derived from the requested time classes (see mapping).
  - `clocks=false`, `evals=false`, `opening=false` — we compute our own.
- **Auth:** optional `Authorization: Bearer <token>` when a token is supplied.
  Unauthenticated works for a single user; the token only raises rate limits.

**Time-class mapping** (Lichess "speed"/perfType ⇄ our `TimeClass`):

| Lichess perfType | our `TimeClass` |
| --- | --- |
| `ultraBullet`, `bullet` | `bullet` |
| `blitz` | `blitz` |
| `rapid` | `rapid` |
| `classical` | `classical` |
| `correspondence` | `daily` |

Requested `TimeClass`es map **back** to perfTypes for the query
(`bullet → ultraBullet,bullet`; `daily → correspondence`; others 1:1), and each
returned game is re-filtered by its mapped class — the same belt-and-suspenders
filter the chess.com adapter applies.

**Field mapping** (Lichess game JSON → `NormalizedGame`):

| `NormalizedGame` field | source |
| --- | --- |
| `source` | `"lichess"` |
| `sourceGameId` | `id` |
| `url` | `https://lichess.org/{id}` |
| `username` | the requested username (as given) |
| `myColor` | which of `players.white/black.user.name` matches (case-insensitive) |
| `result` | from `winner` (`"white"`/`"black"`; absent ⇒ `draw`), from my POV |
| `timeClass` | mapped from `speed`/`perfType` |
| `endTime` | `lastMoveAt` (ms) ÷ 1000, floored |
| `myRating` | `players.{myColor}.rating` (nullable) |
| `oppRating` | `players.{oppColor}.rating` (nullable) |
| `pgn` | the `pgn` field |

**Filters / skips:**
- Skip any game where `variant !== "standard"`.
- Skip games whose mapped `timeClass` is not in the requested set.
- Skip games outside `[since, until]` (re-check after mapping, like chess.com).
- A game missing an expected player/username match is skipped (defensive; a
  user-not-found surfaces as an empty stream, handled below).

### 4.3 Source factory (`server/src/index.ts`)
Replace the unconditional `const source = new ChesscomSource()` (line ~46) with a
pick on `req.source`:
- `"lichess"` → `new LichessSource(process.env.LICHESS_TOKEN)`
- otherwise → `new ChesscomSource()`

Add `LICHESS_TOKEN` (optional) to `server/.env.example` with a comment that it is
only needed to raise rate limits.

### 4.4 Dashboard toggle (`web/src/routes/dashboard.tsx`)
- A source selector (chess.com / Lichess) whose value feeds the existing
  `api.sync.$post({ json: { source, ... } })`.
- The username input's placeholder/label reflects the selected source.
- The 90-day window and default time classes stay hardcoded (per scope choice).

## 5. Error handling (per parent spec §10)
- `404` / empty stream ⇒ surface "username not found / no games" clearly via the
  run report; do not throw a raw error.
- `429` ⇒ respect `Retry-After`, back off, retry; otherwise a non-OK status throws
  with the status code, which the run loop records as a run-report error (same as
  the chess.com adapter — no silent swallowing).
- Per-game mapping failures (malformed line, missing PGN) are skipped and counted,
  consistent with how ingest already reports skipped/unparseable games.

## 6. Testing
- `server/src/sources/lichess.test.ts` over a small **recorded NDJSON fixture**,
  asserting `normalizeLichessGames`:
  - color detection (I am white / I am black, case-insensitive name match),
  - result mapping incl. the draw case (`winner` absent),
  - rating mapping (present and null),
  - time-class mapping incl. `ultraBullet → bullet` and `correspondence → daily`,
  - `variant !== "standard"` skip,
  - `lastMoveAt` ms → seconds conversion,
  - out-of-window and out-of-class skips.
- Pure-logic only: no engine, no live network — runs in the standard `npm test`.
- Mirrors `server/src/sources/chesscom.test.ts` in structure.

## 7. Out of scope / future
- Date-range and time-class UI on the Dashboard.
- Lichess OAuth flow (only a static optional token is supported).
- Importing studies/broadcasts or non-standard variants.
- Reusing Lichess evals/opening tags as an analysis fast path.

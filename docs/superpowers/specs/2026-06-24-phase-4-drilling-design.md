# Phase 4 — Drilling Design Spec

**Date:** 2026-06-24
**Status:** Approved design, ready for implementation planning
**Builds on:** the approved overall design (`2026-06-15-chess-opening-coach-design.md` §12 Phase 4)

## 1. Overview

Drilling turns the app from a diagnostic tool into a practice tool. The user **picks
an opening** (the existing Study picker, or a "recommended" entry seeded from their
leaks) and **plays the line out** move-by-move against a replying opponent until the
line leaves book or hits the opening-phase ply cap. Each of the user's moves is
**graded with the app's existing layered "mistake" rule** (in-book **and** within a
cp-loss threshold); a wrong move is flagged and the user **retries until correct**.
First-try outcomes are persisted per position so the app can recommend what to drill
next.

This is the last planned phase. It deliberately reuses Phase 3 infrastructure
(`/explore`, on-demand `/position`, the leak query, the explorer workspace) and adds
the smallest possible new surface.

## 2. Goals / Non-goals

**Goals**
- Practice a chosen opening by playing it out against a realistic, book-driven opponent.
- Grade the user's moves with the **same** definition of "mistake" the leak report uses,
  so "fails a drill" ⇔ "is a leak" — never a second, conflicting notion of correctness.
- Persist lightweight per-position results and surface a ranked **"recommended to drill"**
  list (leaks ⊕ previously-failed ⊕ stale).
- Show the opponent's replies as **players at the user's rating** play them (the existing
  `rating` book source), with a masters toggle.

**Non-goals (now)**
- Full spaced-repetition scheduling (SM-2 ease/interval math). Deferred; the lightweight
  progress table can grow into it later without a redesign.
- A separate stateful "drill session" server resource. The loop runs client-side over
  existing read endpoints.
- Curated/editable repertoires. "Correct" comes from book + engine, not a user-authored line.
- Multi-move puzzles, tactics, or middlegame drilling — opening phase only, consistent
  with the rest of the app.

## 3. Key decisions (locked)

| Area | Decision |
| --- | --- |
| Unit of practice | **Play the line out** from the picked opening to the book/ply boundary |
| Seed | **User picks** the opening (Study picker); leaks/failed/stale only *recommend* candidates |
| Grading | **Hybrid** — in-book **and** cpLoss ≤ threshold (the existing classifier rule), lifted to a shared pure function |
| Opponent | **Weighted-random** over book move counts; **seeded RNG** per session for reproducibility |
| Book source | `masters` / `rating` toggle, **default `rating`** ("players at your elo") |
| Mistake handling | **Retry until correct**, with the better move(s) shown as a hint; **first-try** result is the one recorded |
| Scheduling | **Lightweight progress tracking** — one append-only `drill_attempts` table; "recommended" is a derived query, not a scheduler |
| Architecture | **Client orchestrates** (Approach 2): `chess.js` + `/explore` per ply; server only persists results + serves the recommended query |
| Drill panel layout | Split right panel — live feedback + accuracy on top, **book theory table stays visible** beneath (learn-as-you-go) |

## 4. Architecture

The drill loop runs entirely in the web app except for the per-position `/explore`
reads and two thin new endpoints. No stateful session lives on the server.

**New code, by package (everything else is reuse):**

```
shared/src/
  grade.ts          gradeDrillMove() — the ONE grading rule, pure; imported by web
                    AND by the server classifier (parity-tested)
  schemas.ts        + DrillSettings, DrillAttempt, DrillResultsBatch, DrillRecommendation

server/src/drill/
  recommendedQuery.ts   ranked "what to drill" = leaks ⊕ failed ⊕ stale, dedup by opening
  resultsStore.ts       persist attempts (write) + read aggregates
  (routes/app.ts)       + POST /drill/results, GET /drill/recommended

web/src/
  routes/drill.tsx          picker + recommended list + drill workspace; /drill route
  hooks/useDrill.ts         the loop: chess.js state, /explore per ply, grade, opponent reply, record
  components/DrillWorkspace  reuses <Chessboard> (move input) + <EvalBar>; split feedback/book panel
  components/AppShell.tsx    + "Drill" sidebar entry (between Study and Settings)
```

**Reused as-is:** `/explore(epd, source)` (book moves with counts + engine multiPV lines +
white-POV eval), `/position?fen=` (on-demand single-position eval), the leak query,
`OpeningPicker`, `Chessboard`, `EvalBar`, `chess.js` (already a web dependency).

### The shared grading rule

Today `server/src/classify/classifier.ts` turns a `cpLoss` into a label. The core
predicate is lifted into `shared/src/grade.ts` so client and server agree by construction:

```ts
gradeDrillMove(input: {
  playedUci: string,
  bookMoves: BookMoveStat[],   // from /explore — defines "in book"
  lines: EngineLine[],         // from /explore — best move + multiPV cp
  playedEvalCp: number | null, // eval after the move, when it isn't in the multiPV (else null)
  settings: DrillSettings,     // { maxCpLoss, bookSource }
}): { inBook: boolean; cpLoss: number | null; pass: boolean }
```

`pass = inBook && cpLoss !== null && cpLoss <= settings.maxCpLoss` — the §7 hybrid rule.
The server classifier is refactored to call this same predicate; a parity test locks
them together.

## 5. Data model

**One new table — `drill_attempts`** (append-only; everything derived is aggregated):

```ts
export const drillAttempts = sqliteTable("drill_attempts", {
  id:          integer("id").primaryKey({ autoIncrement: true }),
  epd:         text("epd").notNull(),         // position the user was asked to move in
  openingEpd:  text("opening_epd"),           // the drilled opening (for grouping/recommend)
  openingName: text("opening_name"),
  color:       text("color").notNull(),       // which side the user drilled
  source:      text("source").notNull(),      // masters | rating (book source used)
  playedUci:   text("played_uci").notNull(),  // the FIRST-TRY move
  pass:        integer("pass", { mode: "boolean" }).notNull(),
  cpLoss:      integer("cp_loss"),            // null when book degraded / unverifiable
  createdAt:   integer("created_at").notNull(),
}, (t) => ({ byEpd: index("drill_attempts_epd_idx").on(t.epd) }));
```

- Only the **first-try** result per position-in-a-line is written; retries don't pollute
  accuracy. Replaying a line another day appends new rows → history accumulates, and
  `epd`-keying matches the rest of the app.
- **No session table** (YAGNI). Last-result, attempts, accuracy, and last-drilled are all
  aggregations over this table.

**`GET /drill/recommended`** is a query, not a table (mirroring how leaks is a query),
unioning three sources, deduped by opening, each row carrying *why*:

1. **Leaks** — from the existing leak query → reason `"leak"`, weight `occurrences × avgCpLoss`.
2. **Previously failed** — openings with a `drill_attempts` row `pass = false` and no later
   passing attempt at that EPD → reason `"failed"`.
3. **Stale** — openings drilled before but not in the last *N* days → reason `"stale"`.

Returns `DrillRecommendation[] = { openingEpd, openingName, eco, reason, score, lastDrilled }`.

## 6. The drill loop (`useDrill`)

**Setup.** Pick an opening EPD + color + book source (default `rating`). `chess.js` is
positioned at the opening's EPD; the drill plays forward from there.

**Per ply:**
1. Fetch `/explore(epd, source)` → `{ bookMoves[], lines[], evalWhiteCp }`.
2. **Opponent's turn** → pick a reply **weighted-random over `bookMoves` counts** (seeded
   RNG), apply, loop.
3. **Your turn** → play move `M` (`chess.js` enforces legality), then `gradeDrillMove`:
   - `inBook` = `M` ∈ `bookMoves`; `cpLoss` from `lines` when `M` is in the multiPV.
   - If `M` is in book but not in the multiPV, one `/position?fen=fenAfter` call supplies its eval.
   - **Pass** → record first-try outcome, apply `M`, continue.
   - **Fail** → flag the square, show the better move(s) + eval as a hint, **don't advance**;
     retry until a move passes. The first-try failure is recorded once.

**Line ends** when the position goes out of book (no `bookMove` above a small frequency
threshold), the ply cap is hit (reuse the configurable opening-phase boundary, ~30), or
there's no legal continuation.

**On completion:** a summary — moves played, **first-try accuracy**, and missed positions
each deep-linking into Study at that EPD (the deep-link pattern already exists). One
`POST /drill/results` writes the batch of first-try attempts. "Drill again" reseeds the
RNG for a fresh branch through the same opening.

**Why batch results at line end:** a line is the natural unit, it's one write instead of
many, and quitting mid-line simply records what was completed (unreached positions aren't
attempts — no partial-credit ambiguity).

## 7. Frontend

**Nav.** A new **"Drill"** sidebar entry and `/drill` route (TanStack Router).

**Pick / landing state:**
- **Recommended list** (default, `GET /drill/recommended`): opening name + ECO + a *why*
  chip (`leak` / `failed` / `stale`) + last-drilled; click to start.
- **`OpeningPicker`** to drill any opening, recommended or not.
- A settings strip — **color**, **book source** (default your-elo), **max cp-loss** — all
  defaulted so the user can just click and go.

**Drilling state — `DrillWorkspace`** over the existing explorer layout: `<Chessboard>`
(move input) center, `<EvalBar>` beside it, and a **split right panel** (chosen layout):
- **top:** turn/progress + running first-try accuracy; on a miss a flagged square + a
  "Better: e6 (book, +0.1)" hint; retry in place.
- **bottom:** the **book theory table stays visible** (learn-as-you-go).
- on out-of-book/cap: the **completion summary** (line SAN, accuracy, missed positions →
  Study), with "Drill again" and "Back to recommendations."

Opponent moves auto-play after a short beat so it feels like a game; the board orients to
the drilled color.

**Component boundaries:** `useDrill` holds *all* loop logic and state (chess.js, fetch,
grade, RNG, results) as a plain state machine; `DrillWorkspace` and children are
presentational — they render `useDrill` state and call `playMove()`. Testable logic stays
in the hook, out of the view.

## 8. Error handling & edge cases

Drilling does many live lookups and must degrade like the rest of the app (§10 of the
overall design — degrade gracefully, never silently swallow):

- **`/explore` 503 / book unavailable** → degrade to **engine-only**: opponent plays the
  engine's top move (no weights to sample), grading falls back to cp-loss alone with a
  visible `book: unknown` note. The drill keeps running.
- **On-demand eval times out** (off-multiPV move) → don't block: surface "couldn't verify,"
  treat the move as **ungraded** (no `drill_attempts` row), let the user continue.
- **Opening has no book data at its start** → caught before play: tell the user and suggest
  the masters source or another opening.
- **Line dead-ends early** → valid, not an error: short line + summary + "your-elo book is
  thin here — try masters" hint.
- **Promotion / checkmate / stalemate in-line** → `chess.js` models these; the line
  terminates and summarizes.
- **`POST /drill/results` fails** → the session already happened; retry once, then a
  non-blocking "couldn't save progress" banner. A lost write only costs that session's
  contribution to "recommended"; no corruption (append-only).
- **Determinism** → the opponent RNG is seeded per session and the seed is kept with the
  summary, so "Drill again → same line" is reproducible and tests are deterministic.

## 9. Testing strategy

Vitest; TDD for pure logic; fixtures for I/O; gated engine tests (per the project pattern).

**Pure unit (test-first) — highest value, since grading lives in shared code:**
- **`gradeDrillMove` (`@coc/shared`)** — in-book + small loss → pass; in-book + over
  threshold → fail; off-book → fail; off-multiPV move with supplied eval → correct cpLoss;
  `book unknown` → engine-only degrade path.
- **Classifier parity** — refactored server `classifier.ts` and `gradeDrillMove` agree on
  the same inputs (locks "fails a drill ⇔ is a leak").
- **Opponent selection** — weighted-random over counts with an **injected seed**:
  distribution sanity + exact determinism for a fixed seed.
- **Line termination** — out-of-book threshold and ply-cap boundaries.
- **`recommendedQuery` ranking** — leaks ⊕ failed ⊕ stale, dedup-by-opening, reason
  precedence, ordering.

**Server integration (temp SQLite + fixtures):**
- `POST /drill/results` writes first-try attempts; `GET /drill/recommended` over seeded
  `drill_attempts` + games/moves fixtures returns the expected ranked list with reasons.

**Frontend component (jsdom + mocked RPC):**
- `useDrill` driven by a mocked `/explore`: retry-until-correct (board waits on a miss,
  advances on a pass), opponent auto-reply, first-try-only recording, line end → summary →
  results posted, and the degrade path (mock a 503 → engine-only, drill completes).
- `DrillWorkspace` render: split panel shows accuracy + miss hint + book table; completion
  summary deep-links missed positions to Study.

**Not automated** (matches README "deferred/manual"): a real end-to-end drill against the
live Lichess book + Stockfish — needs the binary, seeded openings, and network.

**Determinism throughout:** seeded RNG for the opponent, fixtures for book responses, temp
SQLite for DB — no live network in the suite.

## 10. Open questions / future

- **`maxCpLoss` default** — start at the classifier's existing inaccuracy threshold (~50cp);
  tune with real drilling once it's in use. Configurable from the start.
- **Stale window `N`** — start at ~14 days; configurable.
- **Growth path to true SRS** — the `drill_attempts` table already records per-position
  pass/fail over time; adding ease/interval columns and a scheduler later is additive, not
  a rewrite.
- **Start position** — drills begin at the *opening's* EPD and play forward. A future option
  could replay from move 1 for openings the user wants to rehearse from the root.

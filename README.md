# Chess Opening Coach

A personal, local web app that pulls your chess.com games, analyzes the **opening
phase** with a native **Stockfish** engine cross-referenced against the **Lichess
opening book**, and surfaces a ranked **leak report** of your recurring opening
mistakes — openingtree.com, but every move gets Stockfish's verdict.

> **Status:** Phases 0–4. Imports chess.com games, analyzes openings, and shows the leak
> report, repertoire **Tree**, per-game **Review**, **Study** (browse a line over book +
> our eval), and **Drill** (rehearse a picked opening against a book opponent, graded by
> the same rule as the leak report). Lichess import is still pending (see
> `docs/superpowers/specs/2026-06-15-chess-opening-coach-design.md`).

## Architecture

npm-workspaces monorepo:

- **`shared/`** (`@coc/shared`) — Zod schemas + types shared by client and server.
- **`server/`** (`@coc/server`) — Hono + Drizzle/libSQL backend; owns a long-lived
  native Stockfish process and the in-process analysis queue. Positions are deduped
  and cached by EPD so each unique position is analyzed once.
- **`web/`** (`@coc/web`) — React + Vite + TanStack Router/Query + Zod, chessground board.

## Setup

1. **Install:** `npm install`

2. **Stockfish binary** (required for analysis): download a native build from
   <https://stockfishchess.org/download/> and place it at `server/engine/stockfish.exe`
   (Windows) or `server/engine/stockfish` (mac/Linux, then `chmod +x`). Copy
   `server/.env.example` to `server/.env` and set `STOCKFISH_PATH` to that path.

3. **Database:** `npm run db:generate -w @coc/server && npm run db:migrate -w @coc/server`
   (creates `server/data/app.db`).

4. **Opening names** (for grouping leaks per opening): download the opening TSVs
   (`a.tsv`…`e.tsv`) from <https://github.com/lichess-org/chess-openings> into
   `server/data/openings/`, then seed: `npm run db:seed -w @coc/server`.

## Run

- Terminal 1 — backend: `npm run dev:server` (serves on http://localhost:8787)
- Terminal 2 — frontend: `npm run dev:web` → open http://localhost:5173

In the **Dashboard**, enter your chess.com username and click **Sync & analyze**;
watch progress reach `done`, then open **Leaks** for the ranked report.

## Test

- `npm test` — shared + server unit/integration suites (pure logic; no engine needed).
- `npm run test -w @coc/web` — frontend component tests.
- Engine integration test (needs the Stockfish binary):
  `RUN_ENGINE_TESTS=1 npm run test -w @coc/server`.

## Deferred / manual steps

These need external resources and aren't exercised by the automated suites:

- The Stockfish binary (step 2) and the openings TSVs (step 4).
- The end-to-end smoke (real sync of your games → analysis → leak report) requires
  the binary, the seeded openings, and a real chess.com username.

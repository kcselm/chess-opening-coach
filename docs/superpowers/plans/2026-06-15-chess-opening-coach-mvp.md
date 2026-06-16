# Chess Opening Coach MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chess Opening Coach MVP — pull chess.com games, analyze the opening phase with native Stockfish, and surface a ranked "leak report" of recurring opening mistakes.

**Architecture:** npm-workspaces monorepo with three packages: `@coc/shared` (Zod schemas + types), `@coc/server` (Hono + Drizzle/libSQL + a long-lived native Stockfish child process), and `@coc/web` (React + Vite + TanStack Router/Query, chessground board). Backend owns the engine and an in-process analysis queue; positions are deduped and cached by EPD so each unique position is analyzed once. Phase 0 builds the backend walking skeleton (ingest → analyze → store, driven over HTTP). Phase 1 adds the book/classification layer and the React leak-report UI.

**Tech Stack:** TypeScript, Node 24, Hono, Drizzle ORM + `@libsql/client`, native Stockfish (UCI), chess.js, React + Vite, TanStack Router + Query, Zod, chessground, Vitest.

---

## Conventions

- **Package names:** `@coc/shared`, `@coc/server`, `@coc/web`. Root is private with `workspaces`.
- **EPD key:** the first 4 fields of a FEN (placement, side, castling, en-passant) — drops the half/full-move clocks so transpositions share a cache entry. `toEpd(fen)` produces it. All caches (`position_evals`, `book_stats`, `openings`) key on EPD; full FENs are kept on `moves` only for board rendering.
- **Eval sign convention:** Stockfish `score cp` is from the side-to-move's perspective. For a user move at `fenBefore`, `cpLoss = evalCp(fenBefore) + evalCp(fenAfter)` (both side-to-move perspective), clamped to ≥ 0. Mate scores are mapped to a large cp via `MATE_CP = 100000 - mateDistance`.
- **Test runner:** Vitest. Server tests run in `node` env; web tests in `jsdom`. Engine-integration tests are gated behind `RUN_ENGINE_TESTS=1` because they need the Stockfish binary.
- **Commits:** conventional-commit style, one per task step where indicated.

## File Structure

```
chess-opening-coach/
  package.json                      root, private, workspaces
  tsconfig.base.json                shared compiler options
  shared/
    package.json
    tsconfig.json
    src/
      index.ts                      re-exports
      schemas.ts                    Zod schemas + inferred types (the contract)
      epd.ts                        toEpd(), scoreToCp()
  server/
    package.json
    tsconfig.json
    vitest.config.ts
    drizzle.config.ts
    .env.example
    src/
      db/
        schema.ts                   Drizzle tables
        client.ts                   db handle (libSQL)
      engine/
        uci.ts                      pure UCI line parsers
        engineManager.ts            spawn Stockfish, analyze(epd)
      sources/
        types.ts                    GameSource interface
        chesscom.ts                 chess.com adapter
      ingest/
        pgn.ts                      replay + opening-phase extraction (pure)
        ingestService.ts            fetch → upsert games + moves
      openings/
        namer.ts                    EPD → opening name (pure)
        seed.ts                     load Lichess openings TSV → openings table
      book/
        explorerClient.ts           Lichess Opening Explorer + cache
      classify/
        classifier.ts              (pure) bookStatus + cpLoss + label
        classifyService.ts          write classification onto moves
      analysis/
        orchestrator.ts             queue: unique EPDs → engine → position_evals
      leaks/
        leaksQuery.ts               ranked leak query
      routes/
        app.ts                      Hono app + AppType export
      runStore.ts                   in-memory run/progress registry
      index.ts                      server entry (serve)
    test/fixtures/                  recorded API responses
  web/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx
      router.tsx
      api/client.ts                 Hono RPC client + query helpers
      components/
        AppShell.tsx                sidebar nav
        Chessboard.tsx              chessground wrapper
        EvalBar.tsx
        ExplorerLines.tsx           engine lines for detail
        SyncProgress.tsx            SSE consumer
      routes/
        dashboard.tsx
        leaks.tsx
```

---

# PHASE 0 — Walking Skeleton (backend)

## Task 1: Root monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "chess-opening-coach",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "web"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build:shared": "npm run build -w @coc/shared",
    "dev:server": "npm run dev -w @coc/server",
    "dev:web": "npm run dev -w @coc/web",
    "test": "npm run test -w @coc/shared && npm run test -w @coc/server"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json tsconfig.base.json
git commit -m "chore: root monorepo scaffold with npm workspaces"
```

## Task 2: `@coc/shared` package — the type contract

**Files:**
- Create: `shared/package.json`, `shared/tsconfig.json`
- Create: `shared/src/epd.ts`, `shared/src/schemas.ts`, `shared/src/index.ts`
- Test: `shared/src/epd.test.ts`

- [ ] **Step 1: Create `shared/package.json`**

```json
{
  "name": "@coc/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

- [ ] **Step 2: Create `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing test for `toEpd` and `scoreToCp`**

Create `shared/src/epd.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toEpd, scoreToCp } from "./epd.js";

describe("toEpd", () => {
  it("drops the halfmove and fullmove clocks", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    expect(toEpd(fen)).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3");
  });
});

describe("scoreToCp", () => {
  it("returns cp directly when not mate", () => {
    expect(scoreToCp({ scoreCp: 35, mateIn: null })).toBe(35);
  });
  it("maps positive mate to a large positive cp by distance", () => {
    expect(scoreToCp({ scoreCp: null, mateIn: 3 })).toBe(100000 - 3);
  });
  it("maps negative mate to a large negative cp", () => {
    expect(scoreToCp({ scoreCp: null, mateIn: -2 })).toBe(-(100000 - 2));
  });
});
```

- [ ] **Step 4: Run the test, expect failure**

Run: `npm install` (from repo root, once) then `npm run test -w @coc/shared`
Expected: FAIL — `Cannot find module './epd.js'`.

- [ ] **Step 5: Implement `shared/src/epd.ts`**

```ts
export function toEpd(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export const MATE_CP = 100000;

export function scoreToCp(s: { scoreCp: number | null; mateIn: number | null }): number {
  if (s.scoreCp !== null) return s.scoreCp;
  if (s.mateIn !== null) {
    const mag = MATE_CP - Math.abs(s.mateIn);
    return s.mateIn > 0 ? mag : -mag;
  }
  return 0;
}
```

- [ ] **Step 6: Create `shared/src/schemas.ts` (the shared contract)**

```ts
import { z } from "zod";

export const Color = z.enum(["white", "black"]);
export type Color = z.infer<typeof Color>;

export const GameResult = z.enum(["win", "loss", "draw"]);
export type GameResult = z.infer<typeof GameResult>;

export const TimeClass = z.enum(["bullet", "blitz", "rapid", "classical", "daily"]);
export type TimeClass = z.infer<typeof TimeClass>;

export const NormalizedGame = z.object({
  source: z.enum(["chesscom", "lichess"]),
  sourceGameId: z.string(),
  url: z.string().nullable(),
  username: z.string(),
  myColor: Color,
  result: GameResult,
  timeClass: TimeClass,
  endTime: z.number().int(), // epoch seconds
  myRating: z.number().int().nullable(),
  oppRating: z.number().int().nullable(),
  pgn: z.string(),
});
export type NormalizedGame = z.infer<typeof NormalizedGame>;

export const EngineLine = z.object({
  rank: z.number().int(),         // multipv rank, 1 = best
  scoreCp: z.number().int().nullable(),
  mateIn: z.number().int().nullable(),
  pvUci: z.array(z.string()),     // principal variation as uci moves
});
export type EngineLine = z.infer<typeof EngineLine>;

export const EvalResult = z.object({
  epd: z.string(),
  depth: z.number().int(),
  engineVersion: z.string(),
  lines: z.array(EngineLine),     // sorted by rank
});
export type EvalResult = z.infer<typeof EvalResult>;

export const BookStatus = z.enum(["in_book", "novelty", "unknown"]);
export type BookStatus = z.infer<typeof BookStatus>;

export const Classification = z.enum(["best", "book", "inaccuracy", "mistake", "blunder"]);
export type Classification = z.infer<typeof Classification>;

export const SyncRequest = z.object({
  source: z.enum(["chesscom"]),   // lichess added in Phase 2
  username: z.string().min(1),
  since: z.number().int(),         // epoch seconds
  until: z.number().int(),
  timeClasses: z.array(TimeClass).default(["rapid", "blitz", "classical"]),
});
export type SyncRequest = z.infer<typeof SyncRequest>;

export const SyncPhase = z.enum(["fetching", "analyzing", "classifying", "done", "error"]);
export const SyncProgress = z.object({
  runId: z.string(),
  phase: SyncPhase,
  gamesFetched: z.number().int(),
  gamesTotal: z.number().int().nullable(),
  positionsAnalyzed: z.number().int(),
  positionsTotal: z.number().int().nullable(),
  message: z.string().optional(),
});
export type SyncProgress = z.infer<typeof SyncProgress>;

export const Leak = z.object({
  openingName: z.string(),
  eco: z.string().nullable(),
  fenBefore: z.string(),
  lineSan: z.string(),
  yourMoveSan: z.string(),
  betterMoveSan: z.string().nullable(),
  occurrences: z.number().int(),
  avgCpLoss: z.number(),
  scorePct: z.number(),
  bookStatus: BookStatus,
});
export type Leak = z.infer<typeof Leak>;
```

- [ ] **Step 7: Create `shared/src/index.ts`**

```ts
export * from "./schemas.js";
export * from "./epd.js";
```

- [ ] **Step 8: Run tests, expect pass**

Run: `npm run test -w @coc/shared`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add shared package-lock.json
git commit -m "feat(shared): zod contract + epd/score helpers"
```

## Task 3: `@coc/server` package scaffold

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/.env.example`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "@coc/server",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@coc/shared": "*",
    "@hono/node-server": "^1.13.0",
    "@hono/zod-validator": "^0.4.0",
    "@libsql/client": "^0.14.0",
    "chess.js": "^1.0.0",
    "dotenv": "^16.4.5",
    "drizzle-orm": "^0.36.0",
    "hono": "^4.6.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 4: Create `server/.env.example`**

```
# Path to the native Stockfish binary. On Windows, e.g. ./engine/stockfish.exe
STOCKFISH_PATH=./engine/stockfish.exe
# SQLite (libSQL) database file
DATABASE_URL=file:./data/app.db
# Engine analysis settings
ENGINE_DEPTH=18
ENGINE_MULTIPV=3
ENGINE_THREADS=4
PORT=8787
```

- [ ] **Step 5: Install + commit**

Run: `npm install` (repo root).

```bash
git add server package.json package-lock.json
git commit -m "chore(server): package scaffold (hono, drizzle, libsql, chess.js)"
```

## Task 4: Database schema + client

**Files:**
- Create: `server/src/db/schema.ts`, `server/src/db/client.ts`, `server/src/db/migrate.ts`, `server/drizzle.config.ts`
- Test: `server/src/db/schema.test.ts`

> **Why generate+migrate, not `drizzle-kit push`:** `drizzle-kit push` for the `sqlite` dialect pulls in `better-sqlite3`, whose native prebuilds may not exist for Node 24's ABI (forcing a Visual Studio build on Windows). `drizzle-kit generate` only reads the schema and emits SQL — no driver — and we apply that SQL with the pure-JS libSQL migrator. Zero native builds.

- [ ] **Step 1: Create `server/src/db/schema.ts`**

```ts
import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(), // `${source}:${sourceGameId}`
  source: text("source").notNull(),
  url: text("url"),
  username: text("username").notNull(),
  myColor: text("my_color").notNull(),
  result: text("result").notNull(),
  timeClass: text("time_class").notNull(),
  endTime: integer("end_time").notNull(),
  eco: text("eco"),
  openingName: text("opening_name"),
  myRating: integer("my_rating"),
  oppRating: integer("opp_rating"),
  pgn: text("pgn").notNull(),
});

export const moves = sqliteTable(
  "moves",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gameId: text("game_id").notNull(),
    ply: integer("ply").notNull(),
    fenBefore: text("fen_before").notNull(),
    fenAfter: text("fen_after").notNull(),
    epdBefore: text("epd_before").notNull(),
    epdAfter: text("epd_after").notNull(),
    san: text("san").notNull(),
    uci: text("uci").notNull(),
    isMine: integer("is_mine", { mode: "boolean" }).notNull(),
    bookStatus: text("book_status"),
    evalBestCp: integer("eval_best_cp"),
    evalPlayedCp: integer("eval_played_cp"),
    cpLoss: integer("cp_loss"),
    classification: text("classification"),
  },
  (t) => ({ byEpdBefore: index("moves_epd_before_idx").on(t.epdBefore) })
);

export const positionEvals = sqliteTable(
  "position_evals",
  {
    epd: text("epd").notNull(),
    depth: integer("depth").notNull(),
    engineVersion: text("engine_version").notNull(),
    scoreCp: integer("score_cp"),
    mateIn: integer("mate_in"),
    linesJson: text("lines_json").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.epd, t.depth, t.engineVersion] }) })
);

export const bookStats = sqliteTable(
  "book_stats",
  {
    epd: text("epd").notNull(),
    source: text("source").notNull(),
    total: integer("total").notNull(),
    movesJson: text("moves_json").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.epd, t.source] }) })
);

export const openings = sqliteTable("openings", {
  epd: text("epd").primaryKey(),
  eco: text("eco").notNull(),
  name: text("name").notNull(),
});
```

- [ ] **Step 2: Create `server/src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.js";

export function createDb(url = process.env.DATABASE_URL ?? "file:./data/app.db") {
  const client = createClient({ url });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };
```

- [ ] **Step 3: Create `server/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "file:./data/app.db" },
});
```

- [ ] **Step 4: Write the failing test (in-memory db round-trip)**

Create `server/src/db/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import * as schema from "./schema.js";

async function memDb() {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  // create tables directly for the test (mirrors drizzle-kit push output)
  const c = (db as any).session.client as ReturnType<typeof createClient>;
  await c.execute(`CREATE TABLE games (id text primary key, source text, url text, username text,
    my_color text, result text, time_class text, end_time integer, eco text, opening_name text,
    my_rating integer, opp_rating integer, pgn text);`);
  return db;
}

describe("games table", () => {
  it("inserts and reads a row", async () => {
    const db = await memDb();
    await db.insert(schema.games).values({
      id: "chesscom:1", source: "chesscom", url: null, username: "me",
      myColor: "white", result: "win", timeClass: "rapid", endTime: 1700000000,
      eco: null, openingName: null, myRating: 1500, oppRating: 1490, pgn: "1. e4 e5",
    });
    const rows = await db.select().from(schema.games).where(eq(schema.games.id, "chesscom:1"));
    expect(rows[0]?.pgn).toBe("1. e4 e5");
  });
});
```

- [ ] **Step 5: Run test, expect failure → then pass**

Run: `npm run test -w @coc/server`
Expected first run: FAIL until `schema.ts`/`client.ts` exist and compile; then PASS.

- [ ] **Step 6: Create `server/src/db/migrate.ts`**

```ts
import "dotenv/config";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb } from "./client.js";

await migrate(createDb(), { migrationsFolder: "./drizzle" });
console.log("migrations applied");
```

- [ ] **Step 7: Generate and apply the schema to the local DB**

Run: `npm run db:generate -w @coc/server` (emits SQL into `server/drizzle/`)
Then: `npm run db:migrate -w @coc/server`
Expected: `server/data/app.db` exists with all tables. Verify the round-trip test (Step 5) still passes.

- [ ] **Step 8: Commit**

```bash
git add server/src/db server/drizzle.config.ts server/drizzle
git commit -m "feat(server): drizzle schema (games, moves, evals, book, openings) + db client + libsql migrate"
```

## Task 5: UCI line parsers (pure)

**Files:**
- Create: `server/src/engine/uci.ts`
- Test: `server/src/engine/uci.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/engine/uci.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseInfoLine, parseBestMove } from "./uci.js";

describe("parseInfoLine", () => {
  it("parses a cp score with multipv and pv", () => {
    const line =
      "info depth 18 seldepth 24 multipv 1 score cp 34 nodes 1000 pv e2e4 e7e5 g1f3";
    expect(parseInfoLine(line)).toEqual({
      depth: 18, rank: 1, scoreCp: 34, mateIn: null, pvUci: ["e2e4", "e7e5", "g1f3"],
    });
  });
  it("parses a mate score", () => {
    const line = "info depth 20 multipv 2 score mate -3 pv d1h5 e8e7";
    expect(parseInfoLine(line)).toEqual({
      depth: 20, rank: 2, scoreCp: null, mateIn: -3, pvUci: ["d1h5", "e8e7"],
    });
  });
  it("returns null for non-info lines", () => {
    expect(parseInfoLine("readyok")).toBeNull();
    expect(parseInfoLine("info string NNUE evaluation using ...")).toBeNull();
  });
});

describe("parseBestMove", () => {
  it("extracts the best move", () => {
    expect(parseBestMove("bestmove e2e4 ponder e7e5")).toBe("e2e4");
  });
  it("returns null when absent", () => {
    expect(parseBestMove("info depth 1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -w @coc/server -- uci`
Expected: FAIL — `Cannot find module './uci.js'`.

- [ ] **Step 3: Implement `server/src/engine/uci.ts`**

```ts
export interface InfoLine {
  depth: number;
  rank: number;
  scoreCp: number | null;
  mateIn: number | null;
  pvUci: string[];
}

export function parseInfoLine(line: string): InfoLine | null {
  if (!line.startsWith("info ")) return null;
  if (!line.includes(" pv ") || !line.includes(" score ")) return null; // skip "info string", currmove, etc.
  const tok = line.split(/\s+/);
  const num = (key: string): number | null => {
    const i = tok.indexOf(key);
    return i >= 0 && i + 1 < tok.length ? Number(tok[i + 1]) : null;
  };
  const depth = num("depth");
  const rank = num("multipv") ?? 1;
  const scoreIdx = tok.indexOf("score");
  let scoreCp: number | null = null;
  let mateIn: number | null = null;
  if (scoreIdx >= 0) {
    const kind = tok[scoreIdx + 1];
    const val = Number(tok[scoreIdx + 2]);
    if (kind === "cp") scoreCp = val;
    else if (kind === "mate") mateIn = val;
  }
  const pvIdx = tok.indexOf("pv");
  const pvUci = pvIdx >= 0 ? tok.slice(pvIdx + 1) : [];
  if (depth === null) return null;
  return { depth, rank, scoreCp, mateIn, pvUci };
}

export function parseBestMove(line: string): string | null {
  if (!line.startsWith("bestmove ")) return null;
  const m = line.split(/\s+/)[1];
  return m && m !== "(none)" ? m : null;
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm run test -w @coc/server -- uci`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/uci.ts server/src/engine/uci.test.ts
git commit -m "feat(server): pure UCI info/bestmove parsers"
```

## Task 6: Engine manager (native Stockfish over UCI)

**Files:**
- Create: `server/src/engine/engineManager.ts`
- Test: `server/src/engine/engineManager.integration.test.ts`
- Manual: download Stockfish binary into `server/engine/`

- [ ] **Step 1: Obtain the Stockfish binary (manual, one-time)**

Download the native Stockfish for your OS from https://stockfishchess.org/download/ and place the executable at `server/engine/stockfish.exe` (Windows) or `server/engine/stockfish` (mac/Linux, `chmod +x`). Copy `server/.env.example` to `server/.env` and set `STOCKFISH_PATH` to that path. Confirm it runs:

Run: `./server/engine/stockfish.exe` then type `uci` then `quit`.
Expected: prints engine name and `uciok`.

- [ ] **Step 2: Implement `server/src/engine/engineManager.ts`**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { EvalResult, EngineLine } from "@coc/shared";
import { parseInfoLine, parseBestMove, type InfoLine } from "./uci.js";

export interface EngineOptions {
  path?: string;
  threads?: number;
  multipv?: number;
}

export class EngineManager {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private version = "unknown";
  private queue: Promise<unknown> = Promise.resolve(); // serialize analyses
  constructor(private opts: EngineOptions = {}) {}

  async start(): Promise<void> {
    const path = this.opts.path ?? process.env.STOCKFISH_PATH ?? "./engine/stockfish";
    const proc = spawn(path, [], { stdio: "pipe" });
    proc.on("error", (e) => {
      throw new Error(`Failed to start Stockfish at "${path}": ${e.message}. Set STOCKFISH_PATH.`);
    });
    this.proc = proc;
    await this.handshake();
    this.send(`setoption name Threads value ${this.opts.threads ?? Number(process.env.ENGINE_THREADS ?? 4)}`);
    this.send(`setoption name MultiPV value ${this.opts.multipv ?? Number(process.env.ENGINE_MULTIPV ?? 3)}`);
  }

  private send(cmd: string) {
    this.proc!.stdin.write(cmd + "\n");
  }

  private handshake(): Promise<void> {
    return new Promise((resolve) => {
      const rl = createInterface({ input: this.proc!.stdout });
      const onLine = (line: string) => {
        if (line.startsWith("id name ")) this.version = line.slice("id name ".length).trim();
        if (line === "uciok") {
          rl.off("line", onLine);
          rl.close();
          // Attach the readyok listener BEFORE sending isready, or the reply can race ahead of us.
          const rl2 = createInterface({ input: this.proc!.stdout });
          rl2.on("line", (l) => {
            if (l === "readyok") { rl2.close(); resolve(); }
          });
          this.send("isready");
        }
      };
      rl.on("line", onLine);
      this.send("uci");
    });
  }

  /** Analyze a position (full FEN) to a fixed depth. Serialized: one go at a time. */
  analyze(fen: string, depth: number, multipv: number): Promise<EvalResult> {
    const run = () => this.analyzeNow(fen, depth, multipv);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  private analyzeNow(fen: string, depth: number, multipv: number): Promise<EvalResult> {
    return new Promise((resolve) => {
      const byRank = new Map<number, InfoLine>();
      const rl = createInterface({ input: this.proc!.stdout });
      rl.on("line", (line) => {
        const info = parseInfoLine(line);
        if (info && info.depth >= 1) byRank.set(info.rank, info);
        if (parseBestMove(line) !== null) {
          rl.close();
          const lines: EngineLine[] = [...byRank.values()]
            .sort((a, b) => a.rank - b.rank)
            .map((i) => ({ rank: i.rank, scoreCp: i.scoreCp, mateIn: i.mateIn, pvUci: i.pvUci }));
          const top = lines[0];
          resolve({
            epd: fen.split(" ").slice(0, 4).join(" "),
            depth,
            engineVersion: this.version,
            lines: lines.length ? lines : [{ rank: 1, scoreCp: top?.scoreCp ?? 0, mateIn: null, pvUci: [] }],
          });
        }
      });
      this.send("ucinewgame");
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
    });
  }

  async stop(): Promise<void> {
    if (this.proc) { this.send("quit"); this.proc.kill(); this.proc = null; }
  }
}
```

- [ ] **Step 3: Write the engine integration test (gated)**

Create `server/src/engine/engineManager.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EngineManager } from "./engineManager.js";

const RUN = process.env.RUN_ENGINE_TESTS === "1";

describe.runIf(RUN)("EngineManager (real binary)", () => {
  const engine = new EngineManager({ multipv: 3 });
  beforeAll(async () => { await engine.start(); }, 30000);
  afterAll(async () => { await engine.stop(); });

  it("finds a strong first move from the start position", async () => {
    const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const res = await engine.analyze(startFen, 14, 3);
    expect(res.lines.length).toBeGreaterThan(0);
    expect(res.lines[0]!.pvUci[0]).toMatch(/^[a-h][1-2][a-h][1-4]/); // a real opening move
    expect(Math.abs(res.lines[0]!.scoreCp ?? 0)).toBeLessThan(100); // start is roughly equal
  }, 30000);
});
```

- [ ] **Step 4: Run the gated test, expect pass**

Run: `RUN_ENGINE_TESTS=1 npm run test -w @coc/server -- engineManager`
Expected: PASS (skips automatically if `RUN_ENGINE_TESTS` unset).

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/engineManager.ts server/src/engine/engineManager.integration.test.ts
git commit -m "feat(server): native Stockfish engine manager with serialized analyze()"
```

## Task 7: chess.com GameSource adapter

**Files:**
- Create: `server/src/sources/types.ts`, `server/src/sources/chesscom.ts`
- Test: `server/src/sources/chesscom.test.ts`
- Fixture: `server/test/fixtures/chesscom-archive.json`

- [ ] **Step 1: Create `server/src/sources/types.ts`**

```ts
import type { NormalizedGame, TimeClass } from "@coc/shared";

export interface FetchParams {
  username: string;
  since: number; // epoch seconds
  until: number;
  timeClasses: TimeClass[];
}

export interface GameSource {
  id: "chesscom" | "lichess";
  fetchGames(params: FetchParams): AsyncIterable<NormalizedGame>;
}
```

- [ ] **Step 2: Create the fixture `server/test/fixtures/chesscom-archive.json`**

```json
{
  "games": [
    {
      "url": "https://www.chess.com/game/live/1",
      "pgn": "[Event \"Live Chess\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0",
      "time_class": "rapid",
      "rated": true,
      "rules": "chess",
      "end_time": 1700000000,
      "white": { "username": "Me", "rating": 1500, "result": "win" },
      "black": { "username": "Opp", "rating": 1490, "result": "resigned" }
    },
    {
      "url": "https://www.chess.com/game/live/2",
      "pgn": "[Result \"1/2-1/2\"]\n\n1. d4 d5 1/2-1/2",
      "time_class": "blitz",
      "rated": true,
      "rules": "chess",
      "end_time": 1700100000,
      "white": { "username": "Opp", "rating": 1600, "result": "agreed" },
      "black": { "username": "me", "rating": 1550, "result": "agreed" }
    },
    {
      "url": "https://www.chess.com/game/live/3",
      "pgn": "1. e4 1-0",
      "time_class": "bullet",
      "rules": "chess960",
      "end_time": 1700200000,
      "white": { "username": "Me", "rating": 1500, "result": "win" },
      "black": { "username": "Opp", "rating": 1400, "result": "checkmated" }
    }
  ]
}
```

- [ ] **Step 3: Write the failing test**

Create `server/src/sources/chesscom.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeChesscomGames } from "./chesscom.js";

const archive = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../test/fixtures/chesscom-archive.json", import.meta.url)), "utf8")
);

describe("normalizeChesscomGames", () => {
  const out = normalizeChesscomGames(archive.games, "me", ["rapid", "blitz", "classical"]);

  it("maps my color and result case-insensitively", () => {
    expect(out[0]).toMatchObject({ myColor: "white", result: "win", timeClass: "rapid" });
    expect(out[1]).toMatchObject({ myColor: "black", result: "draw", timeClass: "blitz" });
  });
  it("filters out variants (chess960) and disallowed time classes (bullet)", () => {
    expect(out).toHaveLength(2);
    expect(out.some((g) => g.sourceGameId === "3")).toBe(false);
  });
  it("captures ratings and source ids", () => {
    expect(out[0]).toMatchObject({ source: "chesscom", sourceGameId: "1", myRating: 1500, oppRating: 1490 });
  });
});
```

- [ ] **Step 4: Run test, expect failure**

Run: `npm run test -w @coc/server -- chesscom`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `server/src/sources/chesscom.ts`**

```ts
import type { NormalizedGame, TimeClass, GameResult } from "@coc/shared";
import type { FetchParams, GameSource } from "./types.js";

const DRAW_RESULTS = new Set([
  "agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient",
]);

interface ChesscomPlayer { username: string; rating?: number; result: string }
interface ChesscomGame {
  url: string; pgn: string; time_class: string; rules: string; end_time: number;
  white: ChesscomPlayer; black: ChesscomPlayer;
}

function resultFor(my: ChesscomPlayer): GameResult {
  if (my.result === "win") return "win";
  if (DRAW_RESULTS.has(my.result)) return "draw";
  return "loss";
}

export function normalizeChesscomGames(
  games: ChesscomGame[], username: string, timeClasses: TimeClass[]
): NormalizedGame[] {
  const uname = username.toLowerCase();
  const allowed = new Set(timeClasses);
  const out: NormalizedGame[] = [];
  for (const g of games) {
    if (g.rules !== "chess") continue; // skip variants
    if (!allowed.has(g.time_class as TimeClass)) continue;
    const iAmWhite = g.white.username.toLowerCase() === uname;
    const me = iAmWhite ? g.white : g.black;
    const opp = iAmWhite ? g.black : g.white;
    out.push({
      source: "chesscom",
      sourceGameId: g.url.split("/").pop() ?? g.url,
      url: g.url,
      username,
      myColor: iAmWhite ? "white" : "black",
      result: resultFor(me),
      timeClass: g.time_class as TimeClass,
      endTime: g.end_time,
      myRating: me.rating ?? null,
      oppRating: opp.rating ?? null,
      pgn: g.pgn,
    });
  }
  return out;
}

export class ChesscomSource implements GameSource {
  id = "chesscom" as const;
  async *fetchGames(params: FetchParams): AsyncIterable<NormalizedGame> {
    const months = monthsBetween(params.since, params.until);
    for (const { year, month } of months) {
      const url = `https://api.chess.com/pub/player/${params.username}/games/${year}/${month}`;
      const res = await fetch(url, { headers: { "User-Agent": "chess-opening-coach" } });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`chess.com ${res.status} for ${url}`);
      const data = (await res.json()) as { games: ChesscomGame[] };
      for (const g of normalizeChesscomGames(data.games, params.username, params.timeClasses)) {
        if (g.endTime >= params.since && g.endTime <= params.until) yield g;
      }
    }
  }
}

function monthsBetween(since: number, until: number): { year: string; month: string }[] {
  const out: { year: string; month: string }[] = [];
  const start = new Date(since * 1000);
  const end = new Date(until * 1000);
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (d <= end) {
    out.push({ year: String(d.getUTCFullYear()), month: String(d.getUTCMonth() + 1).padStart(2, "0") });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}
```

- [ ] **Step 6: Run test, expect pass**

Run: `npm run test -w @coc/server -- chesscom`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add server/src/sources server/test/fixtures/chesscom-archive.json
git commit -m "feat(server): chess.com game source adapter with variant/time-class filtering"
```

## Task 8: PGN replay + opening-phase extraction (pure)

**Files:**
- Create: `server/src/ingest/pgn.ts`
- Test: `server/src/ingest/pgn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/ingest/pgn.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractOpeningMoves } from "./pgn.js";

describe("extractOpeningMoves", () => {
  const pgn = "[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0";

  it("returns one record per ply with fen/san/uci and isMine", () => {
    const moves = extractOpeningMoves(pgn, "white", 30);
    expect(moves).toHaveLength(4);
    expect(moves[0]).toMatchObject({ ply: 0, san: "e4", uci: "e2e4", isMine: true });
    expect(moves[1]).toMatchObject({ ply: 1, san: "e5", uci: "e7e5", isMine: false });
    expect(moves[2]).toMatchObject({ ply: 2, san: "Nf3", isMine: true });
  });

  it("computes fenBefore/fenAfter consistently (after of ply k == before of ply k+1)", () => {
    const moves = extractOpeningMoves(pgn, "white", 30);
    expect(moves[0]!.fenAfter).toBe(moves[1]!.fenBefore);
  });

  it("caps at maxPlies", () => {
    expect(extractOpeningMoves(pgn, "white", 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -w @coc/server -- pgn`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/ingest/pgn.ts`**

```ts
import { Chess } from "chess.js";
import type { Color } from "@coc/shared";
import { toEpd } from "@coc/shared";

export interface OpeningMove {
  ply: number;
  fenBefore: string;
  fenAfter: string;
  epdBefore: string;
  epdAfter: string;
  san: string;
  uci: string;
  isMine: boolean;
}

export function extractOpeningMoves(pgn: string, myColor: Color, maxPlies: number): OpeningMove[] {
  const replay = new Chess();
  const history = (() => {
    const tmp = new Chess();
    tmp.loadPgn(pgn);
    return tmp.history(); // SAN strings
  })();

  const out: OpeningMove[] = [];
  for (let ply = 0; ply < history.length && ply < maxPlies; ply++) {
    const fenBefore = replay.fen();
    const sideToMove: Color = replay.turn() === "w" ? "white" : "black";
    const move = replay.move(history[ply]!); // applies and returns move object
    const uci = move.from + move.to + (move.promotion ?? "");
    const fenAfter = replay.fen();
    out.push({
      ply,
      fenBefore,
      fenAfter,
      epdBefore: toEpd(fenBefore),
      epdAfter: toEpd(fenAfter),
      san: move.san,
      uci,
      isMine: sideToMove === myColor,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm run test -w @coc/server -- pgn`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/ingest/pgn.ts server/src/ingest/pgn.test.ts
git commit -m "feat(server): pure PGN opening-phase extraction via chess.js"
```

## Task 9: Ingest service (adapter + pgn → DB)

**Files:**
- Create: `server/src/ingest/ingestService.ts`
- Test: `server/src/ingest/ingestService.test.ts`

- [ ] **Step 1: Write the failing test (fixture adapter + in-memory db)**

Create `server/src/ingest/ingestService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { ingestGames } from "./ingestService.js";
import type { GameSource, FetchParams } from "../sources/types.js";
import type { NormalizedGame } from "@coc/shared";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE games (id text primary key, source text, url text, username text,
    my_color text, result text, time_class text, end_time integer, eco text, opening_name text,
    my_rating integer, opp_rating integer, pgn text);`);
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  return drizzle(c, { schema });
}

const sample: NormalizedGame = {
  source: "chesscom", sourceGameId: "1", url: null, username: "me", myColor: "white",
  result: "win", timeClass: "rapid", endTime: 1700000000, myRating: 1500, oppRating: 1490,
  pgn: "[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0",
};

class FakeSource implements GameSource {
  id = "chesscom" as const;
  constructor(private games: NormalizedGame[]) {}
  async *fetchGames(_p: FetchParams) { for (const g of this.games) yield g; }
}

const params: FetchParams = { username: "me", since: 0, until: 2_000_000_000, timeClasses: ["rapid"] };

describe("ingestGames", () => {
  it("inserts games and their opening moves", async () => {
    const db = await memDb();
    const res = await ingestGames(db, new FakeSource([sample]), params, 30);
    expect(res.gamesInserted).toBe(1);
    const moves = await db.select().from(schema.moves);
    expect(moves).toHaveLength(4);
    expect(moves[0]!.san).toBe("e4");
  });

  it("is idempotent — re-ingesting the same game inserts nothing new", async () => {
    const db = await memDb();
    await ingestGames(db, new FakeSource([sample]), params, 30);
    const res = await ingestGames(db, new FakeSource([sample]), params, 30);
    expect(res.gamesInserted).toBe(0);
    expect(await db.select().from(schema.moves)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -w @coc/server -- ingestService`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/ingest/ingestService.ts`**

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import type { GameSource, FetchParams } from "../sources/types.js";
import { extractOpeningMoves } from "./pgn.js";

export interface IngestResult { gamesInserted: number; gameIds: string[] }

export async function ingestGames(
  db: Db, source: GameSource, params: FetchParams, maxPlies: number,
  onProgress?: (gamesFetched: number) => void
): Promise<IngestResult> {
  let fetched = 0;
  let inserted = 0;
  const gameIds: string[] = [];
  for await (const g of source.fetchGames(params)) {
    fetched++;
    onProgress?.(fetched);
    const id = `${g.source}:${g.sourceGameId}`;
    const existing = await db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.id, id));
    if (existing.length) continue;
    await db.insert(schema.games).values({
      id, source: g.source, url: g.url, username: g.username, myColor: g.myColor,
      result: g.result, timeClass: g.timeClass, endTime: g.endTime, eco: null, openingName: null,
      myRating: g.myRating, oppRating: g.oppRating, pgn: g.pgn,
    });
    const moves = extractOpeningMoves(g.pgn, g.myColor, maxPlies);
    if (moves.length) {
      await db.insert(schema.moves).values(
        moves.map((m) => ({
          gameId: id, ply: m.ply, fenBefore: m.fenBefore, fenAfter: m.fenAfter,
          epdBefore: m.epdBefore, epdAfter: m.epdAfter, san: m.san, uci: m.uci, isMine: m.isMine,
        }))
      );
    }
    inserted++;
    gameIds.push(id);
  }
  return { gamesInserted: inserted, gameIds };
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm run test -w @coc/server -- ingestService`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/ingest/ingestService.ts server/src/ingest/ingestService.test.ts
git commit -m "feat(server): idempotent ingest service (games + opening moves)"
```

## Task 10: Analysis orchestrator (unique EPDs → engine → cache)

**Files:**
- Create: `server/src/analysis/orchestrator.ts`
- Test: `server/src/analysis/orchestrator.test.ts`

The orchestrator collects every distinct EPD that is either an `epdBefore` or `epdAfter` of an analyzable move (so both sides of `cpLoss` are available), skips EPDs already cached, analyzes the rest, and stores results. The engine is injected as an interface so the test can use a fake.

- [ ] **Step 1: Write the failing test (fake engine + in-memory db)**

Create `server/src/analysis/orchestrator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { analyzePositions, type Analyzer } from "./orchestrator.js";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  await c.execute(`CREATE TABLE position_evals (epd text, depth integer, engine_version text,
    score_cp integer, mate_in integer, lines_json text, primary key (epd, depth, engine_version));`);
  return drizzle(c, { schema });
}

const fakeEngine: Analyzer = {
  version: "fake-1",
  async analyze(fen, depth) {
    return { epd: fen.split(" ").slice(0, 4).join(" "), depth, engineVersion: "fake-1",
      lines: [{ rank: 1, scoreCp: 20, mateIn: null, pvUci: ["e2e4"] }] };
  },
};

describe("analyzePositions", () => {
  it("analyzes each unique EPD once and caches it", async () => {
    const db = await memDb();
    await db.insert(schema.moves).values([
      { gameId: "g1", ply: 0, fenBefore: "A w - -", fenAfter: "B b - -",
        epdBefore: "A w - -", epdAfter: "B b - -", san: "e4", uci: "e2e4", isMine: true },
      { gameId: "g2", ply: 0, fenBefore: "A w - -", fenAfter: "B b - -",
        epdBefore: "A w - -", epdAfter: "B b - -", san: "e4", uci: "e2e4", isMine: true },
    ]);
    let calls = 0;
    const counting: Analyzer = { version: "fake-1", async analyze(f, d) { calls++; return fakeEngine.analyze(f, d, 3); } };
    const res = await analyzePositions(db, counting, { depth: 12, multipv: 3 });
    expect(calls).toBe(2); // unique EPDs A and B, deduped across the two games
    expect(res.analyzed).toBe(2);
    const cached = await db.select().from(schema.positionEvals);
    expect(cached).toHaveLength(2);
  });

  it("skips EPDs already cached", async () => {
    const db = await memDb();
    await db.insert(schema.moves).values([
      { gameId: "g1", ply: 0, fenBefore: "A w - -", fenAfter: "B b - -",
        epdBefore: "A w - -", epdAfter: "B b - -", san: "e4", uci: "e2e4", isMine: true },
    ]);
    await db.insert(schema.positionEvals).values({ epd: "A w - -", depth: 12, engineVersion: "fake-1",
      scoreCp: 10, mateIn: null, linesJson: "[]" });
    let calls = 0;
    const counting: Analyzer = { version: "fake-1", async analyze(f, d) { calls++; return fakeEngine.analyze(f, d, 3); } };
    await analyzePositions(db, counting, { depth: 12, multipv: 3 });
    expect(calls).toBe(1); // only B; A already cached
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -w @coc/server -- orchestrator`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/analysis/orchestrator.ts`**

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import type { EvalResult } from "@coc/shared";
import { scoreToCp } from "@coc/shared";

export interface Analyzer {
  version: string;
  analyze(fen: string, depth: number, multipv: number): Promise<EvalResult>;
}

export interface AnalyzeOptions { depth: number; multipv: number }

export async function analyzePositions(
  db: Db, engine: Analyzer, opts: AnalyzeOptions,
  onProgress?: (analyzed: number, total: number) => void
): Promise<{ analyzed: number }> {
  // Collect unique (epd, full fen) pairs from both sides of each move.
  const rows = await db.select({
    epdBefore: schema.moves.epdBefore, fenBefore: schema.moves.fenBefore,
    epdAfter: schema.moves.epdAfter, fenAfter: schema.moves.fenAfter,
  }).from(schema.moves);

  const fenByEpd = new Map<string, string>();
  for (const r of rows) {
    if (!fenByEpd.has(r.epdBefore)) fenByEpd.set(r.epdBefore, r.fenBefore);
    if (!fenByEpd.has(r.epdAfter)) fenByEpd.set(r.epdAfter, r.fenAfter);
  }

  const targets = [...fenByEpd.entries()];
  let analyzed = 0;
  for (const [epd, fen] of targets) {
    const exists = await db.select({ epd: schema.positionEvals.epd })
      .from(schema.positionEvals)
      .where(and(eq(schema.positionEvals.epd, epd), eq(schema.positionEvals.depth, opts.depth),
        eq(schema.positionEvals.engineVersion, engine.version)));
    if (exists.length) continue;

    const res = await engine.analyze(fen, opts.depth, opts.multipv);
    const best = res.lines[0];
    await db.insert(schema.positionEvals).values({
      epd, depth: opts.depth, engineVersion: engine.version,
      scoreCp: best?.scoreCp ?? null, mateIn: best?.mateIn ?? null,
      linesJson: JSON.stringify(res.lines),
    });
    analyzed++;
    onProgress?.(analyzed, targets.length);
  }
  return { analyzed };
}

/** Best eval (cp, side-to-move perspective) for an EPD from the cache, or null. */
export async function cachedBestCp(db: Db, epd: string, depth: number, version: string): Promise<number | null> {
  const rows = await db.select().from(schema.positionEvals)
    .where(and(eq(schema.positionEvals.epd, epd), eq(schema.positionEvals.depth, depth),
      eq(schema.positionEvals.engineVersion, version)));
  const r = rows[0];
  if (!r) return null;
  return scoreToCp({ scoreCp: r.scoreCp, mateIn: r.mateIn });
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm run test -w @coc/server -- orchestrator`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/analysis/orchestrator.ts server/src/analysis/orchestrator.test.ts
git commit -m "feat(server): analysis orchestrator with EPD dedup + cache"
```

## Task 11: Run registry + Hono app with `/sync` and SSE progress

**Files:**
- Create: `server/src/runStore.ts`, `server/src/routes/app.ts`
- Test: `server/src/routes/app.test.ts`

- [ ] **Step 1: Create `server/src/runStore.ts`**

```ts
import type { SyncProgress } from "@coc/shared";

export class RunStore {
  private runs = new Map<string, SyncProgress>();
  private listeners = new Map<string, Set<(p: SyncProgress) => void>>();
  private counter = 0;

  create(): string {
    const runId = `run_${++this.counter}`;
    this.runs.set(runId, { runId, phase: "fetching", gamesFetched: 0, gamesTotal: null,
      positionsAnalyzed: 0, positionsTotal: null });
    this.listeners.set(runId, new Set());
    return runId;
  }
  get(runId: string): SyncProgress | undefined { return this.runs.get(runId); }
  update(runId: string, patch: Partial<SyncProgress>) {
    const cur = this.runs.get(runId);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.runs.set(runId, next);
    for (const l of this.listeners.get(runId) ?? []) l(next);
  }
  subscribe(runId: string, fn: (p: SyncProgress) => void): () => void {
    this.listeners.get(runId)?.add(fn);
    return () => this.listeners.get(runId)?.delete(fn);
  }
}
```

- [ ] **Step 2: Write the failing test for the app**

Create `server/src/routes/app.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { RunStore } from "../runStore.js";

describe("POST /sync", () => {
  it("validates the body and returns a runId", async () => {
    const runStore = new RunStore();
    const app = createApp({ runStore, startSync: async () => {} });
    const res = await app.request("/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "chesscom", username: "me", since: 0, until: 1, timeClasses: ["rapid"] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ runId: expect.stringMatching(/^run_/) });
  });

  it("rejects an invalid body", async () => {
    const app = createApp({ runStore: new RunStore(), startSync: async () => {} });
    const res = await app.request("/sync", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "chesscom" }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `npm run test -w @coc/server -- routes/app`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `server/src/routes/app.ts`**

```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { SyncRequest } from "@coc/shared";
import type { RunStore } from "../runStore.js";

export interface AppDeps {
  runStore: RunStore;
  startSync: (runId: string, req: SyncRequest) => Promise<void>;
}

export function createApp(deps: AppDeps) {
  const app = new Hono()
    .post("/sync", zValidator("json", SyncRequest), (c) => {
      const req = c.req.valid("json");
      const runId = deps.runStore.create();
      void deps.startSync(runId, req); // fire-and-forget; progress via SSE
      return c.json({ runId });
    })
    .get("/sync/:id/progress", (c) => {
      const runId = c.req.param("id");
      return streamSSE(c, async (stream) => {
        const cur = deps.runStore.get(runId);
        if (cur) await stream.writeSSE({ data: JSON.stringify(cur) });
        await new Promise<void>((resolve) => {
          const unsub = deps.runStore.subscribe(runId, (p) => {
            void stream.writeSSE({ data: JSON.stringify(p) });
            if (p.phase === "done" || p.phase === "error") { unsub(); resolve(); }
          });
        });
      });
    });
  return app;
}

export type AppType = ReturnType<typeof createApp>;
```

- [ ] **Step 5: Run test, expect pass**

Run: `npm run test -w @coc/server -- routes/app`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/runStore.ts server/src/routes/app.ts server/src/routes/app.test.ts
git commit -m "feat(server): hono app with validated /sync + SSE progress"
```

## Task 12: Server entry — wire the pipeline and run it

**Files:**
- Create: `server/src/index.ts`
- Modify: `server/src/routes/app.ts` (no change; we pass a real `startSync`)

- [ ] **Step 1: Implement `server/src/index.ts`**

```ts
import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./routes/app.js";
import { RunStore } from "./runStore.js";
import { createDb } from "./db/client.js";
import { EngineManager } from "./engine/engineManager.js";
import { ChesscomSource } from "./sources/chesscom.js";
import { ingestGames } from "./ingest/ingestService.js";
import { analyzePositions } from "./analysis/orchestrator.js";
import type { SyncRequest } from "@coc/shared";

const PORT = Number(process.env.PORT ?? 8787);
const DEPTH = Number(process.env.ENGINE_DEPTH ?? 18);
const MULTIPV = Number(process.env.ENGINE_MULTIPV ?? 3);
const MAX_PLIES = 30;

const db = createDb();
const runStore = new RunStore();
const engine = new EngineManager();
let engineStarted = false;

async function startSync(runId: string, req: SyncRequest) {
  try {
    if (!engineStarted) { await engine.start(); engineStarted = true; }
    runStore.update(runId, { phase: "fetching" });
    const source = new ChesscomSource();
    await ingestGames(db, source, req, MAX_PLIES, (gamesFetched) =>
      runStore.update(runId, { gamesFetched }));

    runStore.update(runId, { phase: "analyzing" });
    const analyzer = { version: (engine as any).version ?? "stockfish",
      analyze: (fen: string, d: number, mpv: number) => engine.analyze(fen, d, mpv) };
    await analyzePositions(db, analyzer, { depth: DEPTH, multipv: MULTIPV },
      (positionsAnalyzed, positionsTotal) =>
        runStore.update(runId, { positionsAnalyzed, positionsTotal }));

    runStore.update(runId, { phase: "done" });
  } catch (e) {
    runStore.update(runId, { phase: "error", message: (e as Error).message });
  }
}

const app = createApp({ runStore, startSync });
serve({ fetch: app.fetch, port: PORT });
console.log(`server on http://localhost:${PORT}`);
```

- [ ] **Step 2: Confirm `dotenv` is installed**

`dotenv` was added to `@coc/server` deps in Task 3, so it's already present. If not: `npm install` from the repo root.

- [ ] **Step 3: Manual end-to-end smoke test (real engine + network)**

Ensure `server/.env` has a valid `STOCKFISH_PATH`. Start the server:

Run: `npm run dev -w @coc/server`

In another terminal, kick off a small sync (use your own chess.com username and a recent ~1-month window in epoch seconds):

```bash
curl -s -X POST http://localhost:8787/sync -H "content-type: application/json" \
  -d '{"source":"chesscom","username":"YOUR_NAME","since":1714521600,"until":1717200000,"timeClasses":["rapid"]}'
# -> {"runId":"run_1"}
curl -N http://localhost:8787/sync/run_1/progress
# -> SSE stream of progress JSON ending with {"phase":"done",...}
```

Expected: progress advances through `fetching` → `analyzing` → `done`, and `server/data/app.db` now has `games`, `moves`, and `position_evals` rows.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts server/package.json package-lock.json
git commit -m "feat(server): wire ingest+analyze pipeline behind /sync (Phase 0 walking skeleton)"
```

**✅ Phase 0 complete:** username → fetch → analyze with real Stockfish → positions cached in SQLite, with live SSE progress.

---

# PHASE 1 — Leak Report

## Task 13: Lichess Opening Explorer book client + cache

**Files:**
- Create: `server/src/book/explorerClient.ts`
- Test: `server/src/book/explorerClient.test.ts`
- Fixture: `server/test/fixtures/explorer-masters.json`

- [ ] **Step 1: Create fixture `server/test/fixtures/explorer-masters.json`**

```json
{
  "white": 1200, "draws": 900, "black": 700,
  "moves": [
    { "uci": "e2e4", "san": "e4", "white": 600, "draws": 450, "black": 350 },
    { "uci": "d2d4", "san": "d4", "white": 500, "draws": 400, "black": 300 }
  ]
}
```

- [ ] **Step 2: Write the failing test (parsing + cache via injected fetch & db)**

Create `server/src/book/explorerClient.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as schema from "../db/schema.js";
import { getBook } from "./explorerClient.js";

const masters = readFileSync(fileURLToPath(new URL("../../test/fixtures/explorer-masters.json", import.meta.url)), "utf8");

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE book_stats (epd text, source text, total integer, moves_json text,
    fetched_at integer, primary key (epd, source));`);
  return drizzle(c, { schema });
}

describe("getBook", () => {
  it("fetches, normalizes, and caches book stats", async () => {
    const db = await memDb();
    let fetchCalls = 0;
    const fakeFetch = async () => { fetchCalls++; return new Response(masters, { status: 200 }); };
    const book = await getBook(db, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "masters",
      { fetchFn: fakeFetch as typeof fetch, now: () => 1000 });
    expect(book.total).toBe(2800);
    expect(book.moves[0]).toMatchObject({ san: "e4", count: 1400 });

    // second call hits cache, not the network
    await getBook(db, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "masters",
      { fetchFn: fakeFetch as typeof fetch, now: () => 1000 });
    expect(fetchCalls).toBe(1);
  });
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `npm run test -w @coc/server -- explorerClient`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `server/src/book/explorerClient.ts`**

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";

export type BookSource = "masters" | "rating";

export interface BookMove { san: string; uci: string; count: number; white: number; draws: number; black: number }
export interface Book { epd: string; source: BookSource; total: number; moves: BookMove[] }

interface ExplorerResponse {
  white: number; draws: number; black: number;
  moves: { uci: string; san: string; white: number; draws: number; black: number }[];
}

export interface GetBookOpts {
  fetchFn?: typeof fetch;
  now?: () => number;
  ratings?: number[]; // for the "rating" source (lichess db)
}

export async function getBook(db: Db, epd: string, source: BookSource, opts: GetBookOpts = {}): Promise<Book> {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));

  const cached = await db.select().from(schema.bookStats)
    .where(and(eq(schema.bookStats.epd, epd), eq(schema.bookStats.source, source)));
  if (cached[0]) {
    return { epd, source, total: cached[0].total, moves: JSON.parse(cached[0].movesJson) };
  }

  const fen = `${epd} 0 1`;
  const base = source === "masters" ? "https://explorer.lichess.ovh/masters" : "https://explorer.lichess.ovh/lichess";
  const params = new URLSearchParams({ fen });
  if (source === "rating") {
    params.set("speeds", "blitz,rapid,classical");
    params.set("ratings", (opts.ratings ?? [1600, 1800, 2000]).join(","));
  }
  const res = await fetchFn(`${base}?${params.toString()}`);
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  const data = (await res.json()) as ExplorerResponse;

  const moves: BookMove[] = data.moves.map((m) => ({
    san: m.san, uci: m.uci, count: m.white + m.draws + m.black,
    white: m.white, draws: m.draws, black: m.black,
  }));
  const total = data.white + data.draws + data.black;

  await db.insert(schema.bookStats).values({
    epd, source, total, movesJson: JSON.stringify(moves), fetchedAt: now(),
  });
  return { epd, source, total, moves };
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `npm run test -w @coc/server -- explorerClient`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add server/src/book server/test/fixtures/explorer-masters.json
git commit -m "feat(server): lichess opening explorer client with epd cache"
```

## Task 14: Opening namer + seed

**Files:**
- Create: `server/src/openings/namer.ts`, `server/src/openings/seed.ts`
- Test: `server/src/openings/namer.test.ts`

The namer matches a game's positions against the seeded `openings` table by EPD, picking the deepest (longest-line) match the game passed through.

- [ ] **Step 1: Write the failing test**

Create `server/src/openings/namer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickOpening } from "./namer.js";

const table = new Map<string, { eco: string; name: string }>([
  ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3", { eco: "B00", name: "King's Pawn" }],
  ["rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6", { eco: "B20", name: "Sicilian Defense" }],
]);

describe("pickOpening", () => {
  it("returns the deepest matching opening the game passed through", () => {
    const epdsInOrder = [
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3",
      "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6",
    ];
    expect(pickOpening(epdsInOrder, table)).toEqual({ eco: "B20", name: "Sicilian Defense" });
  });
  it("returns null when nothing matches", () => {
    expect(pickOpening(["unknown w - -"], table)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -w @coc/server -- namer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/openings/namer.ts`**

```ts
export interface OpeningName { eco: string; name: string }

/** Given the EPDs a game passed through (in order), return the deepest named opening. */
export function pickOpening(
  epdsInOrder: string[], table: Map<string, OpeningName>
): OpeningName | null {
  let match: OpeningName | null = null;
  for (const epd of epdsInOrder) {
    const found = table.get(epd);
    if (found) match = found; // later (deeper) match wins
  }
  return match;
}
```

- [ ] **Step 4: Implement `server/src/openings/seed.ts`**

```ts
import { Chess } from "chess.js";
import { toEpd } from "@coc/shared";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";

// Lichess publishes opening TSVs: https://github.com/lichess-org/chess-openings
// Each row: eco \t name \t pgn (e.g. "1. e4 c5"). We convert the pgn to the final EPD.
export interface OpeningRow { eco: string; name: string; pgn: string }

export function rowToEpd(pgn: string): string {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return toEpd(chess.fen());
}

export async function seedOpenings(db: Db, rows: OpeningRow[]): Promise<number> {
  await db.delete(schema.openings);
  let n = 0;
  for (const r of rows) {
    await db.insert(schema.openings).values({ epd: rowToEpd(r.pgn), eco: r.eco, name: r.name })
      .onConflictDoNothing();
    n++;
  }
  return n;
}

/** Load the openings table into a Map for in-process matching. */
export async function loadOpeningTable(db: Db): Promise<Map<string, { eco: string; name: string }>> {
  const rows = await db.select().from(schema.openings);
  return new Map(rows.map((r) => [r.epd, { eco: r.eco, name: r.name }]));
}
```

- [ ] **Step 5: Add a seed test**

Append to `server/src/openings/namer.test.ts`:

```ts
import { rowToEpd } from "./seed.js";

describe("rowToEpd", () => {
  it("converts an opening pgn to its final EPD", () => {
    expect(rowToEpd("1. e4 c5")).toBe("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6");
  });
});
```

- [ ] **Step 6: Run tests, expect pass**

Run: `npm run test -w @coc/server -- namer`
Expected: PASS (3 tests).

- [ ] **Step 7: Download + seed the openings data (manual)**

Download the five TSVs (`a.tsv`…`e.tsv`) from https://github.com/lichess-org/chess-openings into `server/data/openings/`. Add a one-off script `server/src/openings/runSeed.ts`:

```ts
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { createDb } from "../db/client.js";
import { seedOpenings, type OpeningRow } from "./seed.js";

const dir = "./data/openings";
const rows: OpeningRow[] = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsv"))) {
  const text = readFileSync(`${dir}/${f}`, "utf8");
  for (const line of text.split("\n").slice(1)) {
    const [eco, name, pgn] = line.split("\t");
    if (eco && name && pgn) rows.push({ eco, name, pgn });
  }
}
const db = createDb();
seedOpenings(db, rows).then((n) => { console.log(`seeded ${n} openings`); });
```

Run: `npx tsx server/src/openings/runSeed.ts`
Expected: prints `seeded NNNN openings`.

- [ ] **Step 8: Commit**

```bash
git add server/src/openings
git commit -m "feat(server): opening namer + lichess openings seed"
```

## Task 15: Classifier (pure)

**Files:**
- Create: `server/src/classify/classifier.ts`
- Test: `server/src/classify/classifier.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/classify/classifier.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyMove, DEFAULT_THRESHOLDS } from "./classifier.js";

describe("classifyMove", () => {
  const book = { moves: [{ san: "e6", uci: "e7e6" }, { san: "e5", uci: "e7e5" }] };

  it("computes cpLoss from bestCp(before) + bestCp(after)", () => {
    // user to move, best is +30; after the played move opponent is at +10 -> user value -10 -> loss 40
    const r = classifyMove({ playedSan: "e6", bestCpBefore: 30, bestCpAfter: 10,
      book, thresholds: DEFAULT_THRESHOLDS });
    expect(r.cpLoss).toBe(40);
  });

  it("labels by threshold and clamps negative loss to 0", () => {
    expect(classifyMove({ playedSan: "e5", bestCpBefore: 20, bestCpAfter: -25, book,
      thresholds: DEFAULT_THRESHOLDS }).classification).toBe("best"); // loss < 0 -> 0
    expect(classifyMove({ playedSan: "e5", bestCpBefore: 30, bestCpAfter: 40, book,
      thresholds: DEFAULT_THRESHOLDS }).classification).toBe("inaccuracy"); // loss 70
    expect(classifyMove({ playedSan: "e5", bestCpBefore: 30, bestCpAfter: 90, book,
      thresholds: DEFAULT_THRESHOLDS }).classification).toBe("mistake"); // loss 120
    expect(classifyMove({ playedSan: "e5", bestCpBefore: 100, bestCpAfter: 150, book,
      thresholds: DEFAULT_THRESHOLDS }).classification).toBe("blunder"); // loss 250
  });

  it("derives book status from the reference moves", () => {
    expect(classifyMove({ playedSan: "e6", bestCpBefore: 0, bestCpAfter: 0, book,
      thresholds: DEFAULT_THRESHOLDS }).bookStatus).toBe("in_book");
    expect(classifyMove({ playedSan: "Na6", bestCpBefore: 0, bestCpAfter: 0, book,
      thresholds: DEFAULT_THRESHOLDS }).bookStatus).toBe("novelty");
    expect(classifyMove({ playedSan: "e6", bestCpBefore: 0, bestCpAfter: 0, book: null,
      thresholds: DEFAULT_THRESHOLDS }).bookStatus).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -w @coc/server -- classifier`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/classify/classifier.ts`**

```ts
import type { BookStatus, Classification } from "@coc/shared";

export interface Thresholds { inaccuracy: number; mistake: number; blunder: number }
export const DEFAULT_THRESHOLDS: Thresholds = { inaccuracy: 50, mistake: 100, blunder: 200 };

export interface ClassifyInput {
  playedSan: string;
  bestCpBefore: number;            // best eval at fenBefore (side-to-move = mover)
  bestCpAfter: number;             // best eval at fenAfter (side-to-move = opponent)
  book: { moves: { san: string; uci: string }[] } | null;
  thresholds: Thresholds;
}

export interface ClassifyResult {
  cpLoss: number;
  evalPlayedCp: number;
  classification: Classification;
  bookStatus: BookStatus;
}

export function classifyMove(input: ClassifyInput): ClassifyResult {
  const evalPlayedCp = -input.bestCpAfter; // value to mover of the move they played
  const cpLoss = Math.max(0, input.bestCpBefore - evalPlayedCp);

  const t = input.thresholds;
  let classification: Classification;
  if (cpLoss >= t.blunder) classification = "blunder";
  else if (cpLoss >= t.mistake) classification = "mistake";
  else if (cpLoss >= t.inaccuracy) classification = "inaccuracy";
  else classification = "best";

  let bookStatus: BookStatus;
  if (!input.book) bookStatus = "unknown";
  else if (input.book.moves.some((m) => m.san === input.playedSan)) bookStatus = "in_book";
  else bookStatus = "novelty";

  return { cpLoss, evalPlayedCp, classification, bookStatus };
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm run test -w @coc/server -- classifier`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/classify/classifier.ts server/src/classify/classifier.test.ts
git commit -m "feat(server): pure move classifier (cpLoss + label + book status)"
```

## Task 16: Classify service — write classification onto `moves`

**Files:**
- Create: `server/src/classify/classifyService.ts`
- Test: `server/src/classify/classifyService.test.ts`

- [ ] **Step 1: Write the failing test (seeded moves + evals + book)**

Create `server/src/classify/classifyService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { classifyMoves } from "./classifyService.js";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  await c.execute(`CREATE TABLE position_evals (epd text, depth integer, engine_version text,
    score_cp integer, mate_in integer, lines_json text, primary key (epd, depth, engine_version));`);
  await c.execute(`CREATE TABLE book_stats (epd text, source text, total integer, moves_json text,
    fetched_at integer, primary key (epd, source));`);
  return drizzle(c, { schema });
}

describe("classifyMoves", () => {
  it("writes cpLoss, classification and bookStatus for the user's moves", async () => {
    const db = await memDb();
    await db.insert(schema.moves).values({
      gameId: "g1", ply: 0, fenBefore: "A w - - 0 1", fenAfter: "B b - - 0 1",
      epdBefore: "A w - -", epdAfter: "B b - -", san: "Nh3", uci: "g1h3", isMine: true,
    });
    await db.insert(schema.positionEvals).values([
      { epd: "A w - -", depth: 18, engineVersion: "v", scoreCp: 30, mateIn: null, linesJson: "[]" },
      { epd: "B b - -", depth: 18, engineVersion: "v", scoreCp: 90, mateIn: null, linesJson: "[]" },
    ]);
    await db.insert(schema.bookStats).values({ epd: "A w - -", source: "masters", total: 10,
      movesJson: JSON.stringify([{ san: "e4", uci: "e2e4" }]), fetchedAt: 0 });

    const res = await classifyMoves(db, { depth: 18, engineVersion: "v",
      thresholds: { inaccuracy: 50, mistake: 100, blunder: 200 } });
    expect(res.classified).toBe(1);
    const m = (await db.select().from(schema.moves).where(eq(schema.moves.gameId, "g1")))[0]!;
    // bestBefore 30, bestAfter 90 -> evalPlayed -90 -> cpLoss 120 -> mistake; not in book -> novelty
    expect(m.cpLoss).toBe(120);
    expect(m.classification).toBe("mistake");
    expect(m.bookStatus).toBe("novelty");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -w @coc/server -- classifyService`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/classify/classifyService.ts`**

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import { scoreToCp } from "@coc/shared";
import { classifyMove, type Thresholds } from "./classifier.js";

export interface ClassifyServiceOpts {
  depth: number;
  engineVersion: string;
  thresholds: Thresholds;
  bookSource?: "masters" | "rating";
}

export async function classifyMoves(db: Db, opts: ClassifyServiceOpts): Promise<{ classified: number }> {
  const bookSource = opts.bookSource ?? "masters";
  const evalRows = await db.select().from(schema.positionEvals)
    .where(and(eq(schema.positionEvals.depth, opts.depth), eq(schema.positionEvals.engineVersion, opts.engineVersion)));
  const bestByEpd = new Map(evalRows.map((r) => [r.epd, scoreToCp({ scoreCp: r.scoreCp, mateIn: r.mateIn })]));

  const bookRows = await db.select().from(schema.bookStats).where(eq(schema.bookStats.source, bookSource));
  const bookByEpd = new Map(bookRows.map((r) => [r.epd, { moves: JSON.parse(r.movesJson) as { san: string; uci: string }[] }]));

  const moves = await db.select().from(schema.moves).where(eq(schema.moves.isMine, true));
  let classified = 0;
  for (const m of moves) {
    const bestBefore = bestByEpd.get(m.epdBefore);
    const bestAfter = bestByEpd.get(m.epdAfter);
    if (bestBefore === undefined || bestAfter === undefined) continue;
    const r = classifyMove({
      playedSan: m.san, bestCpBefore: bestBefore, bestCpAfter: bestAfter,
      book: bookByEpd.get(m.epdBefore) ?? null, thresholds: opts.thresholds,
    });
    await db.update(schema.moves).set({
      evalBestCp: bestBefore, evalPlayedCp: r.evalPlayedCp, cpLoss: r.cpLoss,
      classification: r.classification, bookStatus: r.bookStatus,
    }).where(eq(schema.moves.id, m.id));
    classified++;
  }
  return { classified };
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm run test -w @coc/server -- classifyService`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/classify/classifyService.ts server/src/classify/classifyService.test.ts
git commit -m "feat(server): classify service writes labels onto user moves"
```

## Task 17: Leaks query

**Files:**
- Create: `server/src/leaks/leaksQuery.ts`
- Test: `server/src/leaks/leaksQuery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/leaks/leaksQuery.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../db/schema.js";
import { getLeaks } from "./leaksQuery.js";

async function memDb() {
  const c = createClient({ url: ":memory:" });
  await c.execute(`CREATE TABLE games (id text primary key, source text, url text, username text,
    my_color text, result text, time_class text, end_time integer, eco text, opening_name text,
    my_rating integer, opp_rating integer, pgn text);`);
  await c.execute(`CREATE TABLE moves (id integer primary key autoincrement, game_id text, ply integer,
    fen_before text, fen_after text, epd_before text, epd_after text, san text, uci text,
    is_mine integer, book_status text, eval_best_cp integer, eval_played_cp integer,
    cp_loss integer, classification text);`);
  await c.execute(`CREATE TABLE position_evals (epd text, depth integer, engine_version text,
    score_cp integer, mate_in integer, lines_json text, primary key (epd, depth, engine_version));`);
  return drizzle(c, { schema });
}

describe("getLeaks", () => {
  it("groups repeated mistakes by position+move, ranked by occurrences*avgLoss", async () => {
    const db = await memDb();
    // two games where I played the same mistake from the same position
    for (const [gid, result] of [["g1", "loss"], ["g2", "draw"]] as const) {
      await db.insert(schema.games).values({ id: gid, source: "chesscom", url: null, username: "me",
        myColor: "white", result, timeClass: "rapid", endTime: 1, eco: "B20",
        openingName: "Sicilian Defense", myRating: 1500, oppRating: 1500, pgn: "" });
      await db.insert(schema.moves).values({ gameId: gid, ply: 4, fenBefore: "P w - - 0 3",
        fenAfter: "Q b - - 0 3", epdBefore: "P w - -", epdAfter: "Q b - -", san: "d4", uci: "d2d4",
        isMine: true, bookStatus: "novelty", evalBestCp: 30, evalPlayedCp: -90, cpLoss: 120,
        classification: "mistake" });
    }
    await db.insert(schema.positionEvals).values({ epd: "P w - -", depth: 18, engineVersion: "v",
      scoreCp: 30, mateIn: null, linesJson: JSON.stringify([{ rank: 1, scoreCp: 30, mateIn: null, pvUci: ["g1f3"] }]) });

    const leaks = await getLeaks(db, { minCpLoss: 100, depth: 18, engineVersion: "v", limit: 20 });
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({
      openingName: "Sicilian Defense", yourMoveSan: "d4", occurrences: 2, avgCpLoss: 120,
    });
    expect(leaks[0]!.scorePct).toBeCloseTo(25); // loss(0) + draw(0.5) over 2 games = 25%
    expect(leaks[0]!.betterMoveSan).toBeTruthy(); // derived from position_evals best line
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -w @coc/server -- leaksQuery`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/leaks/leaksQuery.ts`**

```ts
import { and, eq, gte, sql } from "drizzle-orm";
import { Chess } from "chess.js";
import type { Db } from "../db/client.js";
import { schema } from "../db/client.js";
import type { Leak, BookStatus } from "@coc/shared";

export interface LeaksOptions {
  minCpLoss: number;
  depth: number;
  engineVersion: string;
  limit: number;
}

const SCORE = sql<number>`avg(case ${schema.games.result}
  when 'win' then 1.0 when 'draw' then 0.5 else 0.0 end) * 100`;

export async function getLeaks(db: Db, opts: LeaksOptions): Promise<Leak[]> {
  const rows = await db
    .select({
      openingName: schema.games.openingName,
      eco: schema.games.eco,
      fenBefore: sql<string>`min(${schema.moves.fenBefore})`,
      epdBefore: schema.moves.epdBefore,
      yourMoveSan: schema.moves.san,
      bookStatus: sql<string>`min(${schema.moves.bookStatus})`,
      occurrences: sql<number>`count(*)`,
      avgCpLoss: sql<number>`avg(${schema.moves.cpLoss})`,
      scorePct: SCORE,
    })
    .from(schema.moves)
    .innerJoin(schema.games, eq(schema.moves.gameId, schema.games.id))
    .where(and(eq(schema.moves.isMine, true), gte(schema.moves.cpLoss, opts.minCpLoss)))
    .groupBy(schema.moves.epdBefore, schema.moves.san)
    .orderBy(sql`count(*) * avg(${schema.moves.cpLoss}) desc`)
    .limit(opts.limit);

  // derive betterMoveSan from the cached best line for each position
  const out: Leak[] = [];
  for (const r of rows) {
    out.push({
      openingName: r.openingName ?? "Unknown opening",
      eco: r.eco,
      fenBefore: r.fenBefore,
      lineSan: "", // filled by the per-game view; leak list shows opening + move
      yourMoveSan: r.yourMoveSan,
      betterMoveSan: await bestSanFor(db, r.epdBefore, r.fenBefore, opts),
      occurrences: Number(r.occurrences),
      avgCpLoss: Math.round(Number(r.avgCpLoss)),
      scorePct: Number(r.scorePct),
      bookStatus: (r.bookStatus as BookStatus) ?? "unknown",
    });
  }
  return out;
}

async function bestSanFor(db: Db, epd: string, fen: string, opts: LeaksOptions): Promise<string | null> {
  const rows = await db.select().from(schema.positionEvals).where(
    and(eq(schema.positionEvals.epd, epd), eq(schema.positionEvals.depth, opts.depth),
      eq(schema.positionEvals.engineVersion, opts.engineVersion)));
  const lines = rows[0] ? (JSON.parse(rows[0].linesJson) as { pvUci: string[] }[]) : [];
  const bestUci = lines[0]?.pvUci[0];
  if (!bestUci) return null;
  try {
    const chess = new Chess(fen);
    const mv = chess.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4),
      promotion: bestUci.slice(4, 5) || undefined });
    return mv.san;
  } catch { return null; }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm run test -w @coc/server -- leaksQuery`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/leaks/leaksQuery.ts server/src/leaks/leaksQuery.test.ts
git commit -m "feat(server): ranked leaks query with better-move derivation"
```

## Task 18: Extend the pipeline + add `/leaks` and `/games` routes

**Files:**
- Modify: `server/src/index.ts` (add book lookups, opening naming, classification to `startSync`)
- Modify: `server/src/routes/app.ts` (add `/leaks`, `/games`, `/games/:id`)
- Test: `server/src/routes/app.leaks.test.ts`

- [ ] **Step 1: Write the failing route test**

Create `server/src/routes/app.leaks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { RunStore } from "../runStore.js";
import type { Leak } from "@coc/shared";

const sampleLeak: Leak = {
  openingName: "Sicilian Defense", eco: "B20", fenBefore: "P w - - 0 1", lineSan: "",
  yourMoveSan: "d4", betterMoveSan: "Nf3", occurrences: 3, avgCpLoss: 120, scorePct: 33, bookStatus: "novelty",
};

describe("GET /leaks", () => {
  it("returns leaks from the injected query", async () => {
    const app = createApp({ runStore: new RunStore(), startSync: async () => {},
      getLeaks: async () => [sampleLeak], getGames: async () => [], getGame: async () => null });
    const res = await app.request("/leaks");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([sampleLeak]);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -w @coc/server -- app.leaks`
Expected: FAIL — `getLeaks` not part of `AppDeps`.

- [ ] **Step 3: Extend `server/src/routes/app.ts`**

Replace the `AppDeps` interface and add routes (keep the existing `/sync` routes):

```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { SyncRequest, type Leak } from "@coc/shared";
import type { RunStore } from "../runStore.js";

export interface GameSummary { id: string; openingName: string | null; result: string; timeClass: string; endTime: number }
export interface GameDetail extends GameSummary { moves: unknown[] }

export interface AppDeps {
  runStore: RunStore;
  startSync: (runId: string, req: SyncRequest) => Promise<void>;
  getLeaks?: () => Promise<Leak[]>;
  getGames?: () => Promise<GameSummary[]>;
  getGame?: (id: string) => Promise<GameDetail | null>;
}

export function createApp(deps: AppDeps) {
  const app = new Hono()
    .post("/sync", zValidator("json", SyncRequest), (c) => {
      const req = c.req.valid("json");
      const runId = deps.runStore.create();
      void deps.startSync(runId, req);
      return c.json({ runId });
    })
    .get("/sync/:id/progress", (c) => {
      const runId = c.req.param("id");
      return streamSSE(c, async (stream) => {
        const cur = deps.runStore.get(runId);
        if (cur) await stream.writeSSE({ data: JSON.stringify(cur) });
        await new Promise<void>((resolve) => {
          const unsub = deps.runStore.subscribe(runId, (p) => {
            void stream.writeSSE({ data: JSON.stringify(p) });
            if (p.phase === "done" || p.phase === "error") { unsub(); resolve(); }
          });
        });
      });
    })
    .get("/leaks", async (c) => c.json((await deps.getLeaks?.()) ?? []))
    .get("/games", async (c) => c.json((await deps.getGames?.()) ?? []))
    .get("/games/:id", async (c) => {
      const game = await deps.getGame?.(c.req.param("id"));
      return game ? c.json(game) : c.json({ error: "not found" }, 404);
    });
  return app;
}

export type AppType = ReturnType<typeof createApp>;
```

- [ ] **Step 4: Run the route test, expect pass**

Run: `npm run test -w @coc/server -- app.leaks`
Expected: PASS. Also re-run `npm run test -w @coc/server -- routes/app` to confirm Task 11 tests still pass.

- [ ] **Step 5: Wire the new stages into `startSync` and the routes in `server/src/index.ts`**

Update `server/src/index.ts`: after `analyzePositions`, add book lookups + naming + classification, and pass the query callbacks to `createApp`.

```ts
// add imports
import { getBook } from "./book/explorerClient.js";
import { classifyMoves } from "./classify/classifyService.js";
import { DEFAULT_THRESHOLDS } from "./classify/classifier.js";
import { loadOpeningTable, pickOpening } from "./openings/seed.js"; // pickOpening re-exported below
import { getLeaks } from "./leaks/leaksQuery.js";
import { eq } from "drizzle-orm";
import { schema } from "./db/client.js";
```

Add to `startSync`, between the analyze and `done` steps:

```ts
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

    await classifyMoves(db, { depth: DEPTH, engineVersion: (engine as any).version ?? "stockfish",
      thresholds: DEFAULT_THRESHOLDS });
```

Change the `createApp` call to pass query callbacks:

```ts
const app = createApp({
  runStore, startSync,
  getLeaks: () => getLeaks(db, { minCpLoss: DEFAULT_THRESHOLDS.mistake, depth: DEPTH,
    engineVersion: (engine as any).version ?? "stockfish", limit: 50 }),
  getGames: async () => (await db.select().from(schema.games)).map((g) => ({
    id: g.id, openingName: g.openingName, result: g.result, timeClass: g.timeClass, endTime: g.endTime })),
  getGame: async (id) => {
    const g = (await db.select().from(schema.games).where(eq(schema.games.id, id)))[0];
    if (!g) return null;
    const mv = await db.select().from(schema.moves).where(eq(schema.moves.gameId, id));
    return { id: g.id, openingName: g.openingName, result: g.result, timeClass: g.timeClass,
      endTime: g.endTime, moves: mv };
  },
});
```

Add a re-export so `pickOpening` imports from `seed.js`: append to `server/src/openings/seed.ts`:

```ts
export { pickOpening } from "./namer.js";
```

- [ ] **Step 6: Manual end-to-end check**

Run: `npm run dev -w @coc/server`, repeat the curl sync from Task 12, then:

```bash
curl -s http://localhost:8787/leaks | head -c 500
```

Expected: a JSON array of leak objects (may be empty if you played no mistakes in the window — try a wider window).

- [ ] **Step 7: Commit**

```bash
git add server/src
git commit -m "feat(server): full leak pipeline (book+naming+classify) and /leaks, /games routes"
```

## Task 19: `@coc/web` scaffold (Vite + React + TanStack + RPC client)

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/router.tsx`, `web/src/api/client.ts`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "@coc/web",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@coc/shared": "*",
    "@coc/server": "*",
    "@tanstack/react-query": "^5.59.0",
    "@tanstack/react-router": "^1.58.0",
    "chess.js": "^1.0.0",
    "chessground": "^9.1.1",
    "hono": "^4.6.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `web/vite.config.ts` (proxy API to Hono)**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], include: ["src/**/*.test.tsx"] },
});
```

- [ ] **Step 3: Create `web/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "noEmit": true,
    "paths": { "@coc/server/*": ["../server/src/*"] },
    "types": ["vite/client", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Chess Opening Coach</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 5: Create `web/src/test-setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Create `web/src/api/client.ts` (typed Hono RPC client)**

```ts
import { hc } from "hono/client";
import type { AppType } from "@coc/server/routes/app.js";

// dev: Vite proxies /api -> http://localhost:8787
export const api = hc<AppType>("/api");
```

- [ ] **Step 7: Create `web/src/router.tsx` and `web/src/main.tsx`**

`web/src/router.tsx`:

```tsx
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell.js";
import { DashboardPage } from "./routes/dashboard.js";
import { LeaksPage } from "./routes/leaks.js";

const rootRoute = createRootRoute({ component: () => (<AppShell><Outlet /></AppShell>) });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: DashboardPage });
const leaksRoute = createRoute({ getParentRoute: () => rootRoute, path: "/leaks", component: LeaksPage });

const routeTree = rootRoute.addChildren([dashboardRoute, leaksRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
```

`web/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router.js";

const queryClient = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 8: Install + commit (components added next task; expect a type error until then)**

Run: `npm install`

```bash
git add web package.json package-lock.json
git commit -m "chore(web): vite+react+tanstack scaffold with typed hono rpc client"
```

## Task 20: AppShell (sidebar) + Chessboard + EvalBar components

**Files:**
- Create: `web/src/components/AppShell.tsx`, `web/src/components/Chessboard.tsx`, `web/src/components/EvalBar.tsx`
- Test: `web/src/components/EvalBar.test.tsx`

- [ ] **Step 1: Write a failing component test for EvalBar**

Create `web/src/components/EvalBar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvalBar } from "./EvalBar.js";

describe("EvalBar", () => {
  it("shows the eval in pawns and gives white more height when ahead", () => {
    render(<EvalBar cp={150} />);
    expect(screen.getByText("+1.5")).toBeInTheDocument();
    const white = screen.getByTestId("eval-white");
    expect(Number(white.style.height.replace("%", ""))).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -w @coc/web -- EvalBar`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/components/EvalBar.tsx`**

```tsx
export function EvalBar({ cp }: { cp: number }) {
  // squash cp to a 0..100 white-share via a logistic curve
  const whiteShare = 100 / (1 + Math.exp(-cp / 300));
  const pawns = (cp / 100).toFixed(1);
  const label = cp >= 0 ? `+${pawns}` : pawns;
  return (
    <div style={{ width: 16, height: 200, background: "#444", borderRadius: 4, overflow: "hidden",
      display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div data-testid="eval-white" style={{ height: `${whiteShare}%`, background: "#eee" }} />
      <span style={{ fontSize: 10, textAlign: "center" }}>{label}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm run test -w @coc/web -- EvalBar`
Expected: PASS.

- [ ] **Step 5: Implement `web/src/components/Chessboard.tsx` (chessground wrapper)**

```tsx
import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

export interface BoardArrow { orig: string; dest: string; brush?: "green" | "red" | "blue" }

export function Chessboard({ fen, arrows = [], size = 320 }: { fen: string; arrows?: BoardArrow[]; size?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, { fen, viewOnly: true, coordinates: false });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    api.current?.set({
      fen,
      drawable: { autoShapes: arrows.map((a) => ({ orig: a.orig, dest: a.dest, brush: a.brush ?? "green" })) },
    });
  }, [fen, arrows]);

  return <div ref={el} style={{ width: size, height: size }} />;
}
```

- [ ] **Step 6: Implement `web/src/components/AppShell.tsx`**

```tsx
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/leaks", label: "Leaks" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <nav style={{ width: 180, background: "#1e1e28", color: "#ddd", padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 16 }}>♟ Opening Coach</div>
        {NAV.map((n) => (
          <div key={n.to} style={{ margin: "8px 0" }}>
            <Link to={n.to} style={{ color: "#ddd", textDecoration: "none" }}>{n.label}</Link>
          </div>
        ))}
      </nav>
      <main style={{ flex: 1, padding: 24 }}>{children}</main>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add web/src/components
git commit -m "feat(web): app shell sidebar + chessground board + eval bar"
```

## Task 21: Dashboard / Sync screen

**Files:**
- Create: `web/src/routes/dashboard.tsx`, `web/src/components/SyncProgress.tsx`

- [ ] **Step 1: Implement `web/src/components/SyncProgress.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { SyncProgress as Progress } from "@coc/shared";

export function SyncProgress({ runId }: { runId: string }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    const es = new EventSource(`/api/sync/${runId}/progress`);
    es.onmessage = (e) => {
      const p = JSON.parse(e.data) as Progress;
      setProgress(p);
      if (p.phase === "done" || p.phase === "error") es.close();
    };
    return () => es.close();
  }, [runId]);

  if (!progress) return <p>Starting…</p>;
  return (
    <div>
      <p><b>{progress.phase}</b></p>
      <p>Games fetched: {progress.gamesFetched}</p>
      <p>Positions analyzed: {progress.positionsAnalyzed}{progress.positionsTotal ? ` / ${progress.positionsTotal}` : ""}</p>
      {progress.message && <p style={{ color: "crimson" }}>{progress.message}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Implement `web/src/routes/dashboard.tsx`**

```tsx
import { useState } from "react";
import { api } from "../api/client.js";
import { SyncProgress } from "../components/SyncProgress.js";

export function DashboardPage() {
  const [username, setUsername] = useState("");
  const [runId, setRunId] = useState<string | null>(null);

  async function startSync() {
    const now = Math.floor(Date.now() / 1000);
    const res = await api.sync.$post({
      json: { source: "chesscom", username, since: now - 60 * 60 * 24 * 90, until: now,
        timeClasses: ["rapid", "blitz", "classical"] },
    });
    const { runId } = (await res.json()) as { runId: string };
    setRunId(runId);
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Analyze the last 90 days of your chess.com games.</p>
      <input placeholder="chess.com username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <button onClick={startSync} disabled={!username}>Sync &amp; analyze</button>
      {runId && <SyncProgress runId={runId} />}
    </div>
  );
}
```

- [ ] **Step 3: Manual check**

Run server (`npm run dev -w @coc/server`) and web (`npm run dev -w @coc/web`). Open http://localhost:5173, enter your username, click Sync. Expected: progress advances to `done`.

- [ ] **Step 4: Commit**

```bash
git add web/src/routes/dashboard.tsx web/src/components/SyncProgress.tsx
git commit -m "feat(web): dashboard sync screen with live SSE progress"
```

## Task 22: Leak report table + expandable detail

**Files:**
- Create: `web/src/routes/leaks.tsx`, `web/src/components/ExplorerLines.tsx`
- Test: `web/src/routes/leaks.test.tsx`

- [ ] **Step 1: Write a failing test (rendering + expand) with a mocked client**

Create `web/src/routes/leaks.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Leak } from "@coc/shared";

// chessground manipulates real DOM/measures layout; stub the board so the test stays on the data/UX.
vi.mock("../components/Chessboard.js", () => ({ Chessboard: () => null }));

vi.mock("../api/client.js", () => ({
  api: { leaks: { $get: vi.fn(async () => ({ json: async () => leaks })) } },
}));

const leaks: Leak[] = [{
  openingName: "Sicilian Defense", eco: "B20", fenBefore: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2",
  lineSan: "", yourMoveSan: "d4", betterMoveSan: "Nf3", occurrences: 5, avgCpLoss: 95, scorePct: 40, bookStatus: "novelty",
}];

async function renderPage() {
  const { LeaksPage } = await import("./leaks.js");
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><LeaksPage /></QueryClientProvider>);
}

describe("LeaksPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders a ranked row and expands detail on click", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Sicilian Defense")).toBeInTheDocument());
    expect(screen.getByText("d4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument(); // occurrences
    fireEvent.click(screen.getByText("Sicilian Defense"));
    await waitFor(() => expect(screen.getByTestId("leak-detail")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -w @coc/web -- leaks`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/components/ExplorerLines.tsx`**

```tsx
import type { Leak } from "@coc/shared";
import { Chessboard } from "./Chessboard.js";

export function LeakDetail({ leak }: { leak: Leak }) {
  return (
    <div data-testid="leak-detail" style={{ display: "flex", gap: 16, padding: 12, background: "#f5f6ff" }}>
      <Chessboard fen={leak.fenBefore} size={200} />
      <div>
        <p>You played <b style={{ color: "#c0392b" }}>{leak.yourMoveSan}</b> ({leak.occurrences}×).</p>
        {leak.betterMoveSan && <p>Engine prefers <b style={{ color: "#27ae60" }}>{leak.betterMoveSan}</b>.</p>}
        <p>Average loss: {(leak.avgCpLoss / 100).toFixed(2)} · Score {Math.round(leak.scorePct)}% · {leak.bookStatus}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `web/src/routes/leaks.tsx`**

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Leak } from "@coc/shared";
import { api } from "../api/client.js";
import { LeakDetail } from "../components/ExplorerLines.js";

export function LeaksPage() {
  const { data: leaks = [], isLoading } = useQuery({
    queryKey: ["leaks"],
    queryFn: async () => (await (await api.leaks.$get()).json()) as Leak[],
  });
  const [open, setOpen] = useState<number | null>(null);

  if (isLoading) return <p>Loading leaks…</p>;
  if (!leaks.length) return <p>No leaks yet — run a sync from the Dashboard.</p>;

  return (
    <div>
      <h1>Leak report</h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
            <th>Opening</th><th>You play</th><th>Better</th><th>×</th><th>Avg loss</th><th>Score</th>
          </tr>
        </thead>
        <tbody>
          {leaks.map((leak, i) => (
            <FragmentRow key={i} leak={leak} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({ leak, open, onToggle }: { leak: Leak; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", borderBottom: "1px solid #eee" }}>
        <td>{leak.openingName}</td>
        <td style={{ color: "#c0392b" }}>{leak.yourMoveSan}</td>
        <td style={{ color: "#27ae60" }}>{leak.betterMoveSan ?? "—"}</td>
        <td>{leak.occurrences}</td>
        <td>−{(leak.avgCpLoss / 100).toFixed(2)}</td>
        <td>{Math.round(leak.scorePct)}%</td>
      </tr>
      {open && (
        <tr><td colSpan={6} style={{ padding: 0 }}><LeakDetail leak={leak} /></td></tr>
      )}
    </>
  );
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `npm run test -w @coc/web -- leaks`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/leaks.tsx web/src/components/ExplorerLines.tsx web/src/routes/leaks.test.tsx
git commit -m "feat(web): leak report table with expandable board+engine detail"
```

## Task 23: Final wiring + README + full verification

**Files:**
- Create: `README.md`
- Modify: none (verification task)

- [ ] **Step 1: Create `README.md`**

````markdown
# Chess Opening Coach

Personal, local app that analyzes your chess.com opening play with Stockfish.

## Setup
1. `npm install`
2. Put a native Stockfish binary at `server/engine/stockfish[.exe]`; copy `server/.env.example` to `server/.env` and set `STOCKFISH_PATH`.
3. `npm run db:generate -w @coc/server && npm run db:migrate -w @coc/server`
4. Download Lichess openings TSVs into `server/data/openings/`, then `npx tsx server/src/openings/runSeed.ts`.

## Run
- Terminal 1: `npm run dev:server`
- Terminal 2: `npm run dev:web` → open http://localhost:5173

## Test
- `npm test` (pure logic). Engine integration: `RUN_ENGINE_TESTS=1 npm run test -w @coc/server`.
````

- [ ] **Step 2: Run the full automated test suite**

Run: `npm test`
Expected: all `@coc/shared` and `@coc/server` tests pass.

Run: `npm run test -w @coc/web`
Expected: all web tests pass.

- [ ] **Step 3: Full manual smoke (the MVP acceptance check)**

With the engine binary and openings seeded: start both dev servers, open the Dashboard, enter your chess.com username, click **Sync & analyze**, watch progress reach `done`, then open **Leaks** and confirm a ranked table renders and rows expand to show the board + better move.

Expected: real leaks from your games appear, ranked by occurrences × average loss.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README with setup/run/test instructions (MVP complete)"
```

**✅ Phase 1 complete:** end-to-end leak report from your chess.com games.

---

## Self-Review notes (for the implementer)

- **Spec coverage:** §5 data model → Task 4; §6 pipeline → Tasks 7–12, 18; §7 classification → Tasks 15–16; §8 backend components → Tasks 5–18; §9 frontend → Tasks 19–22; §10 error handling → covered partially (binary-missing message in Task 6, graceful book failure in Task 18 Step 5, idempotent ingest in Task 9); §11 testing → every task is TDD; §12 phasing → Phase 0 ends Task 12, Phase 1 ends Task 23.
- **Deferred to later cycles (not MVP):** lichess source adapter, Tree view, per-game Review UI, Study mode, drilling, the "rating" book toggle in the UI, opening-phase trimming by book-exit (MVP uses a fixed ply-30 cap), per-position engine timeout/restart supervision, run report UI surface. These are intentionally out of the MVP scope set in the spec.
- **Type consistency:** `EvalResult`, `EngineLine`, `NormalizedGame`, `Leak`, `SyncProgress`, `BookStatus`, `Classification` are all defined once in `@coc/shared` (Task 2) and imported everywhere. `analyze(fen, depth, multipv)` signature is consistent across `EngineManager`, the `Analyzer` interface (Task 10), and `index.ts`.

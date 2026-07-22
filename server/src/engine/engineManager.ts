import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { EvalResult, EngineLine } from "@coc/shared";
import { parseInfoLine, type InfoLine } from "./uci.js";

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
    this.proc = proc;
    // Reject start() on a spawn failure (missing/wrong-platform binary) so the caller's try/catch
    // can surface it — throwing inside the 'error' listener would be an uncaught exception instead.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      proc.once("spawn", () => { if (!settled) { settled = true; resolve(); } });
      proc.once("error", (e) => {
        if (settled) return;
        settled = true;
        reject(new Error(`Failed to start Stockfish at "${path}": ${e.message}. Set STOCKFISH_PATH.`));
      });
    });
    // Keep a no-throw error handler for the rest of the process lifetime so a mid-run engine crash
    // doesn't become an uncaught exception; in-flight analyses will simply never resolve and the
    // sync's own error handling/timeout territory takes over.
    proc.on("error", (e) => { console.error(`[engine] ${e.message}`); });
    await this.handshake();
    this.send(`setoption name Threads value ${this.opts.threads ?? 4}`);
    this.send(`setoption name MultiPV value ${this.opts.multipv ?? 3}`);
  }

  private send(cmd: string) {
    this.proc!.stdin.write(cmd + "\n");
  }

  /** Apply Threads to the running engine (a UCI setoption). No-op before start(); start() applies the
   *  initial value. Safe between analyses — the queue serializes them, so the engine is idle here. */
  setThreads(threads: number): void {
    if (this.proc) this.send(`setoption name Threads value ${threads}`);
  }

  /** Apply MultiPV to the running engine (a UCI setoption). No-op before start(). */
  setMultiPV(multipv: number): void {
    if (this.proc) this.send(`setoption name MultiPV value ${multipv}`);
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
        // Resolve on ANY bestmove line — including "bestmove (none)", which Stockfish emits for a
        // terminal (checkmate/stalemate) position. Keying on parseBestMove() !== null would miss
        // "(none)" and hang the serialized queue forever on, e.g., a game mated inside the opening.
        if (line.startsWith("bestmove ")) {
          rl.close();
          const lines: EngineLine[] = [...byRank.values()]
            .sort((a, b) => a.rank - b.rank)
            .map((i) => ({ rank: i.rank, scoreCp: i.scoreCp, mateIn: i.mateIn, pvUci: i.pvUci }));
          const top = lines[0];
          // Terminal positions yield no usable info line; fall back to a neutral 0 cp so downstream
          // scoreToCp() never sees both-null (it throws on that). Eval accuracy for a position that is
          // already mate is unimportant — it sits at the very end of a game, past the opening of interest.
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

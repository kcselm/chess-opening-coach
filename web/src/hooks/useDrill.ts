import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  gradeDrillMove, mulberry32, pickWeighted, toEpd, scoreToCp,
  type Color, type BookSource, type BookMoveStat, type DrillAttempt,
  type ExploreResult, type PositionAnalysis,
} from "@coc/shared";
import { api } from "../api/client.js";

const fenForEpd = (epd: string) => `${epd} 0 1`;
const DRILL_MAX_PLIES = 24;   // plies from the root before the line auto-completes
const OPP_DELAY_MS = 350;     // pause before the opponent replies, so it reads as a game
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface DrillMissed { epd: string; betterSan: string | null }

export interface DrillState {
  status: "loading" | "playing" | "done";
  fen: string;
  movableColor: Color | undefined;            // set only on the user's turn
  dests: Map<string, string[]>;
  bookMoves: BookMoveStat[];
  evalWhiteCp: number | null;
  lineSan: string[];
  feedback: { betterSans: string[] } | null;  // shown on a miss
  correct: number;
  total: number;
  missed: DrillMissed[];
}

export interface UseDrillArgs {
  rootEpd: string; color: Color; source: BookSource; maxCpLoss: number;
  openingName: string | null; seed?: number; oppDelayMs?: number;
}

export type DrillApi = DrillState & {
  playMove: (orig: string, dest: string) => Promise<void>;
  restart: () => void;
};

function legalDests(game: Chess): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const mv of game.moves({ verbose: true })) {
    const arr = m.get(mv.from) ?? []; arr.push(mv.to); m.set(mv.from, arr);
  }
  return m;
}

const initialState: DrillState = {
  status: "loading", fen: "", movableColor: undefined, dests: new Map(), bookMoves: [],
  evalWhiteCp: null, lineSan: [], feedback: null, correct: 0, total: 0, missed: [],
};

export function useDrill(args: UseDrillArgs): DrillApi {
  const [state, setState] = useState<DrillState>(initialState);
  const [restartKey, setRestartKey] = useState(0);

  const gameRef = useRef<Chess | null>(null);
  const rngRef = useRef<() => number>(() => 0);
  const startPliesRef = useRef(0);
  const recordedRef = useRef<Set<string>>(new Set());   // epds with a recorded first try
  const attemptsRef = useRef<DrillAttempt[]>([]);
  const missedRef = useRef<DrillMissed[]>([]);
  const curRef = useRef<{ bookMoves: BookMoveStat[]; lines: ExploreResult["lines"] }>({ bookMoves: [], lines: [] });
  const genRef = useRef(0); // bumped each (re)start; stale async chains bail (StrictMode/restart safe)

  const finish = useCallback(async (gen: number) => {
    if (genRef.current !== gen) return;
    setState((s) => ({ ...s, status: "done", movableColor: undefined, dests: new Map(), feedback: null }));
    if (attemptsRef.current.length) {
      try { await api.drill.results.$post({ json: { attempts: attemptsRef.current } }); } catch { /* surfaced by the page */ }
    }
  }, []);

  const advance = useCallback(async (gen: number) => {
    const game = gameRef.current!;
    if (game.history().length - startPliesRef.current >= DRILL_MAX_PLIES) return finish(gen);

    const epd = toEpd(game.fen());
    let explore: ExploreResult | null = null;
    try {
      const res = await api.explore.$get({ query: { epd, source: args.source } });
      if (res.status === 200) explore = (await res.json()) as ExploreResult;
    } catch { explore = null; }
    if (genRef.current !== gen) return; // a restart/unmount superseded this chain

    const bookMoves = explore?.bookMoves ?? [];
    curRef.current = { bookMoves, lines: explore?.lines ?? [] };
    if (bookMoves.length === 0) return finish(gen); // out of book → end

    const sideToMove: Color = game.turn() === "w" ? "white" : "black";
    const mine = sideToMove === args.color;
    setState((s) => ({
      ...s, status: "playing", fen: game.fen(), bookMoves, evalWhiteCp: explore?.evalWhiteCp ?? null,
      lineSan: game.history(), feedback: null,
      movableColor: mine ? args.color : undefined, dests: mine ? legalDests(game) : new Map(),
    }));

    if (!mine) {
      const pick = pickWeighted(bookMoves, (m) => m.count, rngRef.current);
      if (!pick) return finish(gen);
      await sleep(args.oppDelayMs ?? OPP_DELAY_MS);
      if (genRef.current !== gen) return;
      try { game.move(pick.san); } catch { return finish(gen); }
      await advance(gen);
    }
  }, [args.source, args.color, args.oppDelayMs, finish]);

  // (re)start the drill on mount and on restart()
  useEffect(() => {
    const gen = ++genRef.current;
    const game = new Chess(fenForEpd(args.rootEpd));
    gameRef.current = game;
    rngRef.current = mulberry32((args.seed ?? (Date.now() >>> 0)) + restartKey);
    startPliesRef.current = game.history().length;
    recordedRef.current = new Set();
    attemptsRef.current = [];
    missedRef.current = [];
    setState({ ...initialState });
    void advance(gen);
    return () => { genRef.current++; }; // invalidate this run (StrictMode remount / restart)
  }, [args.rootEpd, args.color, args.source, restartKey, advance]);

  const playMove = useCallback(async (orig: string, dest: string) => {
    const game = gameRef.current;
    if (!game) return;
    const gen = genRef.current;
    const probe = new Chess(game.fen());
    let mv;
    try { mv = probe.move({ from: orig, to: dest, promotion: "q" }); } catch { return; }
    if (!mv) return;
    const uci = mv.from + mv.to + (mv.promotion ?? "");
    const epd = toEpd(game.fen());
    const cur = curRef.current;

    // need an after-eval only when the move isn't already in the multiPV
    let playedEvalCp: number | null = null;
    if (!cur.lines.some((l) => l.pvUci[0] === uci)) {
      try {
        const res = await api.position.$get({ query: { fen: probe.fen() } });
        if (res.status === 200) {
          const pa = (await res.json()) as PositionAnalysis;
          const after = pa.lines[0] ?? null;
          playedEvalCp = after ? -scoreToCp(after) : pa.scoreCp !== null ? -pa.scoreCp : null;
        }
      } catch { /* leave null → ungradable */ }
    }
    if (genRef.current !== gen) return; // a restart superseded this move

    const grade = gradeDrillMove({ playedUci: uci, bookMoves: cur.bookMoves, lines: cur.lines, playedEvalCp, maxCpLoss: args.maxCpLoss });

    // ungradable (no eval available) → accept and continue without recording
    if (grade.cpLoss === null) { game.move(mv.san); await advance(gen); return; }

    const firstTry = !recordedRef.current.has(epd);
    if (firstTry) {
      recordedRef.current.add(epd);
      attemptsRef.current.push({ epd, openingEpd: args.rootEpd, openingName: args.openingName,
        color: args.color, source: args.source, playedUci: uci, pass: grade.pass, cpLoss: grade.cpLoss });
    }

    if (grade.pass) { game.move(mv.san); await advance(gen); return; }

    // miss: keep the board on the user, show the book answers as the hint
    if (firstTry) missedRef.current = [...missedRef.current, { epd, betterSan: cur.bookMoves[0]?.san ?? null }];
    setState((s) => ({
      ...s, feedback: { betterSans: cur.bookMoves.slice(0, 3).map((b) => b.san) },
      correct: attemptsRef.current.filter((a) => a.pass).length, total: attemptsRef.current.length,
      missed: missedRef.current,
    }));
  }, [args.maxCpLoss, args.rootEpd, args.openingName, args.color, args.source, advance]);

  // keep accuracy counters fresh after passing moves too
  useEffect(() => {
    setState((s) => ({ ...s, correct: attemptsRef.current.filter((a) => a.pass).length, total: attemptsRef.current.length }));
  }, [state.fen, state.status]);

  const restart = useCallback(() => setRestartKey((k) => k + 1), []);
  return { ...state, playMove, restart };
}

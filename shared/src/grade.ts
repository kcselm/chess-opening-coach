import { scoreToCp } from "./epd.js";
import type { EngineLine, BookMoveStat } from "./schemas.js";

export const DEFAULT_MAX_CP_LOSS = 50;

/** cp lost by playing a move scoring `playedCp` when the best scores `bestCp` (both from the
 *  side-to-move's perspective at the position before the move). Never negative. Shared by the
 *  drill grader and the server classifier so cp-loss is computed identically everywhere. */
export function moveCpLoss(bestCp: number, playedCp: number): number {
  return Math.max(0, bestCp - playedCp);
}

export interface GradeInput {
  playedUci: string;
  /** Book moves at the position before the move; `null` means the book is unknown (engine-only grade). */
  bookMoves: BookMoveStat[] | null;
  /** MultiPV lines at the position before the move (from the eval cache). */
  lines: EngineLine[];
  /** The played move's score from the PRE-MOVE mover's perspective. The engine's eval at the
   *  position after the move is from the opponent's side-to-move, so the caller must negate it:
   *  pass `-scoreToCp(afterLine)`. Supply only when the move is not in `lines` (else leave null). */
  playedEvalCp: number | null;
  maxCpLoss: number;
}

export interface GradeResult {
  inBook: boolean;
  cpLoss: number | null;
  pass: boolean;
}

/** The hybrid drill rule (spec §7): a move passes when it is in book AND within `maxCpLoss` of best.
 *  When the book is unknown, it degrades to engine-only (cp-loss alone). Returns `cpLoss: null` when
 *  no eval is available (ungradable) — the caller treats that as "couldn't verify". */
export function gradeDrillMove(input: GradeInput): GradeResult {
  const bookKnown = input.bookMoves !== null;
  const inBook = bookKnown && input.bookMoves!.some((m) => m.uci === input.playedUci);

  const bestLine = input.lines[0];
  const bestCp = bestLine ? scoreToCp(bestLine) : null;
  const matched = input.lines.find((l) => l.pvUci[0] === input.playedUci);
  const playedCp = matched ? scoreToCp(matched) : input.playedEvalCp;

  const cpLoss = bestCp !== null && playedCp !== null ? moveCpLoss(bestCp, playedCp) : null;
  const pass = cpLoss !== null && cpLoss <= input.maxCpLoss && (!bookKnown || inBook);
  return { inBook, cpLoss, pass };
}

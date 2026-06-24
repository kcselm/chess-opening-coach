import type { BookStatus, Classification } from "@coc/shared";
import { moveCpLoss } from "@coc/shared";

export interface Thresholds { inaccuracy: number; mistake: number; blunder: number }
export const DEFAULT_THRESHOLDS: Thresholds = { inaccuracy: 50, mistake: 100, blunder: 200 };

export interface ClassifyInput {
  playedSan: string;
  bestCpBefore: number;
  bestCpAfter: number;
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
  const evalPlayedCp = -input.bestCpAfter;
  const cpLoss = moveCpLoss(input.bestCpBefore, evalPlayedCp);

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

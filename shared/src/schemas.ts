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
  endTime: z.number().int(),
  myRating: z.number().int().nullable(),
  oppRating: z.number().int().nullable(),
  pgn: z.string(),
});
export type NormalizedGame = z.infer<typeof NormalizedGame>;

export const EngineLine = z.object({
  rank: z.number().int(),
  scoreCp: z.number().int().nullable(),
  mateIn: z.number().int().nullable(),
  pvUci: z.array(z.string()),
});
export type EngineLine = z.infer<typeof EngineLine>;

export const EvalResult = z.object({
  epd: z.string(),
  depth: z.number().int(),
  engineVersion: z.string(),
  lines: z.array(EngineLine),
});
export type EvalResult = z.infer<typeof EvalResult>;

export const BookStatus = z.enum(["in_book", "novelty", "unknown"]);
export type BookStatus = z.infer<typeof BookStatus>;

export const Classification = z.enum(["best", "book", "inaccuracy", "mistake", "blunder"]);
export type Classification = z.infer<typeof Classification>;

export const SyncRequest = z.object({
  source: z.enum(["chesscom"]), // lichess source lands in Phase 2; MVP syncs chess.com only
  username: z.string().min(1),
  since: z.number().int(),
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
  scorePct: z.number(), // 0–100: the user's score% across games where this leak occurred
  bookStatus: BookStatus,
});
export type Leak = z.infer<typeof Leak>;

export const GameSummary = z.object({
  id: z.string(),
  source: z.enum(["chesscom", "lichess"]),
  openingName: z.string().nullable(),
  eco: z.string().nullable(),
  myColor: Color,
  result: GameResult,
  timeClass: TimeClass,
  endTime: z.number().int(),
  myRating: z.number().int().nullable(),
  oppRating: z.number().int().nullable(),
});
export type GameSummary = z.infer<typeof GameSummary>;

export const ReviewMove = z.object({
  ply: z.number().int(),
  san: z.string(),
  uci: z.string(),
  isMine: z.boolean(),
  fenBefore: z.string(),
  fenAfter: z.string(),
  bookStatus: BookStatus.nullable(),
  classification: Classification.nullable(),
  cpLoss: z.number().int().nullable(),
  // White-POV evals of the positions before/after this ply; null when the position has no cached eval.
  evalBeforeWhiteCp: z.number().int().nullable(),
  evalAfterWhiteCp: z.number().int().nullable(),
  engineLines: z.array(EngineLine),
  betterMoveSan: z.string().nullable(),
  bookMoves: z.array(z.object({ san: z.string(), count: z.number().int() })),
  bookTotal: z.number().int(),
});
export type ReviewMove = z.infer<typeof ReviewMove>;

export const GameReview = GameSummary.extend({
  moves: z.array(ReviewMove),
});
export type GameReview = z.infer<typeof GameReview>;

export const LeakOccurrence = z.object({
  gameId: z.string(),
  ply: z.number().int(),
  result: GameResult,
  endTime: z.number().int(),
  openingName: z.string().nullable(),
  myColor: Color,
});
export type LeakOccurrence = z.infer<typeof LeakOccurrence>;

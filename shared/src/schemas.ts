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
  source: z.enum(["chesscom", "lichess"]),
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

export const BookSource = z.enum(["masters", "rating"]);
export type BookSource = z.infer<typeof BookSource>;

export const OpeningListItem = z.object({
  epd: z.string(),
  eco: z.string(),
  name: z.string(),
});
export type OpeningListItem = z.infer<typeof OpeningListItem>;

export const BookMoveStat = z.object({
  san: z.string(),
  uci: z.string(),
  count: z.number().int(),
  white: z.number().int(),
  draws: z.number().int(),
  black: z.number().int(),
});
export type BookMoveStat = z.infer<typeof BookMoveStat>;

export const ExploreResult = z.object({
  epd: z.string(),
  source: BookSource,
  total: z.number().int(),
  bookMoves: z.array(BookMoveStat),
  // White-POV cp of this position from the cache, or null when uncached.
  evalWhiteCp: z.number().int().nullable(),
  lines: z.array(EngineLine),
});
export type ExploreResult = z.infer<typeof ExploreResult>;

export const PositionAnalysis = z.object({
  epd: z.string(),
  evalWhiteCp: z.number().int().nullable(),
  scoreCp: z.number().int().nullable(),
  mateIn: z.number().int().nullable(),
  lines: z.array(EngineLine),
  depth: z.number().int(),
  engineVersion: z.string(),
});
export type PositionAnalysis = z.infer<typeof PositionAnalysis>;

export const TreeChild = z.object({
  san: z.string(),
  uci: z.string(),
  epdAfter: z.string(),
  count: z.number().int(),
  isMine: z.boolean(),
  classification: Classification.nullable(),
  // Averaged cp-loss of your plays of this move (null when none had a cp-loss).
  avgCpLoss: z.number().nullable(),
  // Objective outcome counts; because the Tree is color-scoped these read as your own W/D/L.
  white: z.number().int(),
  draws: z.number().int(),
  black: z.number().int(),
});
export type TreeChild = z.infer<typeof TreeChild>;

export const TreeChildren = z.object({
  epd: z.string(),
  color: Color,
  children: z.array(TreeChild),
});
export type TreeChildren = z.infer<typeof TreeChildren>;

// One first-try outcome at a position inside a drilled line. `createdAt` is server-stamped, so it
// is not part of this client→server payload.
export const DrillAttempt = z.object({
  epd: z.string(),
  openingEpd: z.string().nullable(),
  openingName: z.string().nullable(),
  color: Color,
  source: BookSource,
  playedUci: z.string(),
  pass: z.boolean(),
  cpLoss: z.number().int().nullable(),
});
export type DrillAttempt = z.infer<typeof DrillAttempt>;

export const DrillResultsBatch = z.object({
  attempts: z.array(DrillAttempt),
});
export type DrillResultsBatch = z.infer<typeof DrillResultsBatch>;

export const DrillReason = z.enum(["leak", "failed", "stale"]);
export type DrillReason = z.infer<typeof DrillReason>;

export const DrillRecommendation = z.object({
  openingEpd: z.string(),
  openingName: z.string(),
  eco: z.string().nullable(),
  reason: DrillReason,
  score: z.number(),
  lastDrilled: z.number().int().nullable(), // epoch seconds; null if never drilled
});
export type DrillRecommendation = z.infer<typeof DrillRecommendation>;

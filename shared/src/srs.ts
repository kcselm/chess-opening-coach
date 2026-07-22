import type { CardState } from "./schemas.js";

export const EF_FLOOR = 1.3;
export const EF_START = 2.5;

export interface GradeBuckets { fail: number; pass: number; best: number }
export interface EaseParams { start: number; floor: number }
export interface DrillTuning { buckets: GradeBuckets; ease: EaseParams }

export const DEFAULT_GRADE_BUCKETS: GradeBuckets = { fail: 2, pass: 4, best: 5 };
export const DEFAULT_EASE: EaseParams = { start: EF_START, floor: EF_FLOOR };
export const DEFAULT_DRILL_TUNING: DrillTuning = { buckets: DEFAULT_GRADE_BUCKETS, ease: DEFAULT_EASE };

/** Map a first-try drill outcome to an SM-2 quality grade 0–5. Buckets default to fail→2 (a lapse,
 *  q<3), in-book pass→4, best move (cpLoss 0)→5. Ungradable moves never reach here. */
export function gradeFromDrill(
  a: { pass: boolean; cpLoss: number | null },
  buckets: GradeBuckets = DEFAULT_GRADE_BUCKETS,
): number {
  if (!a.pass) return buckets.fail;
  return a.cpLoss === 0 ? buckets.best : buckets.pass;
}

/** Advance one card's SM-2 state given a review grade. `prev` is null on the first-ever review.
 *  Pure — time is passed in as `reviewedAt` (epoch seconds); no Date.now(). `ease` sets the starting
 *  ease factor for a new card and the floor; both default to the SM-2 standard 2.5 / 1.3. */
export function scheduleReview(
  prev: CardState | null, grade: number, reviewedAt: number,
  ease: EaseParams = DEFAULT_EASE,
): CardState {
  const efPrev = prev?.easeFactor ?? ease.start;
  const repsPrev = prev?.reps ?? 0;
  const intervalPrev = prev?.intervalDays ?? 0;

  const ef = Math.max(ease.floor, efPrev + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));

  let reps: number, intervalDays: number;
  if (grade >= 3) {
    reps = repsPrev + 1;
    intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(intervalPrev * ef);
  } else {
    reps = 0;
    intervalDays = 1;
  }
  return {
    easeFactor: ef, intervalDays, reps,
    dueAt: reviewedAt + intervalDays * 86400,
    lastReviewedAt: reviewedAt, lastGrade: grade,
  };
}

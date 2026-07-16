import type { CardState } from "./schemas.js";

export const EF_FLOOR = 1.3;
export const EF_START = 2.5;

/** Map a first-try drill outcome to an SM-2 quality grade 0–5. fail → 2 (a lapse, q<3);
 *  in-book pass with some loss → 4; best move (cpLoss 0) → 5. Ungradable moves never reach here. */
export function gradeFromDrill(a: { pass: boolean; cpLoss: number | null }): number {
  if (!a.pass) return 2;
  return a.cpLoss === 0 ? 5 : 4;
}

/** Advance one card's SM-2 state given a review grade. `prev` is null on the first-ever review.
 *  Pure — time is passed in as `reviewedAt` (epoch seconds); no Date.now(). */
export function scheduleReview(prev: CardState | null, grade: number, reviewedAt: number): CardState {
  const efPrev = prev?.easeFactor ?? EF_START;
  const repsPrev = prev?.reps ?? 0;
  const intervalPrev = prev?.intervalDays ?? 0;

  const ef = Math.max(EF_FLOOR, efPrev + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));

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

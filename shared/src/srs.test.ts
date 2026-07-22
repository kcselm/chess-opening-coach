import { describe, it, expect } from "vitest";
import { scheduleReview, gradeFromDrill, EF_FLOOR, EF_START } from "./srs.js";
import type { CardState } from "./schemas.js";

describe("gradeFromDrill", () => {
  it("maps fail→2, in-book pass→4, best move→5", () => {
    expect(gradeFromDrill({ pass: false, cpLoss: 80 })).toBe(2);
    expect(gradeFromDrill({ pass: true, cpLoss: 30 })).toBe(4);
    expect(gradeFromDrill({ pass: true, cpLoss: 0 })).toBe(5);
  });
});

describe("scheduleReview", () => {
  it("uses fixed intervals (1 then 6) for the first two successful reps", () => {
    const first = scheduleReview(null, 5, 1000);
    expect(first).toMatchObject({ reps: 1, intervalDays: 1 });
    expect(first.dueAt).toBe(1000 + 86400);
    const second = scheduleReview(first, 5, first.dueAt);
    expect(second).toMatchObject({ reps: 2, intervalDays: 6 });
    expect(second.dueAt).toBe(first.dueAt + 6 * 86400);
  });

  it("multiplies interval by the ease factor from the third rep", () => {
    const s2: CardState = { easeFactor: 2.5, intervalDays: 6, reps: 2, dueAt: 0, lastReviewedAt: 0, lastGrade: 5 };
    const third = scheduleReview(s2, 5, 500);
    expect(third.easeFactor).toBeCloseTo(2.6, 5);      // grade 5 raises EF by 0.1
    expect(third.intervalDays).toBe(16);               // round(6 * 2.6)
    expect(third.dueAt).toBe(500 + 16 * 86400);
  });

  it("resets reps and interval to 1 on a lapse", () => {
    const s: CardState = { easeFactor: 2.6, intervalDays: 16, reps: 3, dueAt: 0, lastReviewedAt: 0, lastGrade: 5 };
    const lapsed = scheduleReview(s, 2, 900);
    expect(lapsed).toMatchObject({ reps: 0, intervalDays: 1 });
    expect(lapsed.dueAt).toBe(900 + 86400);
  });

  it("floors the ease factor at 1.3 after repeated lapses", () => {
    let s: CardState | null = null;
    for (let i = 0; i < 10; i++) s = scheduleReview(s, 2, i);
    expect(s!.easeFactor).toBe(EF_FLOOR);
  });

  it("starts a brand-new card from the default ease factor", () => {
    expect(scheduleReview(null, 4, 0).easeFactor).toBeCloseTo(EF_START, 5); // grade 4 leaves EF unchanged
  });
});

describe("gradeFromDrill (custom buckets)", () => {
  it("uses the provided buckets instead of the defaults", () => {
    const buckets = { fail: 1, pass: 3, best: 4 };
    expect(gradeFromDrill({ pass: false, cpLoss: 80 }, buckets)).toBe(1);
    expect(gradeFromDrill({ pass: true, cpLoss: 30 }, buckets)).toBe(3);
    expect(gradeFromDrill({ pass: true, cpLoss: 0 }, buckets)).toBe(4);
  });
});

describe("scheduleReview (custom ease)", () => {
  it("starts a new card from the provided ease.start", () => {
    // grade 4 leaves EF unchanged, so a brand-new card keeps ease.start exactly
    expect(scheduleReview(null, 4, 0, { start: 2.0, floor: 1.3 }).easeFactor).toBeCloseTo(2.0, 5);
  });
  it("floors the ease factor at the provided ease.floor after repeated lapses", () => {
    let s: CardState | null = null;
    for (let i = 0; i < 10; i++) s = scheduleReview(s, 2, i, { start: 2.5, floor: 1.5 });
    expect(s!.easeFactor).toBe(1.5);
  });
});

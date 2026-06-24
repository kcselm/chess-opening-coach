import { describe, it, expect } from "vitest";
import { mulberry32, pickWeighted } from "./rng.js";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42), b = mulberry32(42);
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).toBeGreaterThanOrEqual(0);
    expect(seqA[0]).toBeLessThan(1);
  });
  it("differs across seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("pickWeighted", () => {
  const items = [{ n: "a", w: 1 }, { n: "b", w: 99 }];
  it("returns an item from the list", () => {
    const got = pickWeighted(items, (i) => i.w, mulberry32(7));
    expect(items).toContain(got);
  });
  it("favors heavier weights over many draws", () => {
    const rng = mulberry32(123);
    let bs = 0;
    for (let i = 0; i < 200; i++) if (pickWeighted(items, (i2) => i2.w, rng)!.n === "b") bs++;
    expect(bs).toBeGreaterThan(150); // ~99% expected
  });
  it("returns the first item when all weights are zero, null when empty", () => {
    expect(pickWeighted(items, () => 0, mulberry32(1))).toBe(items[0]);
    expect(pickWeighted([], () => 1, mulberry32(1))).toBeNull();
  });
});

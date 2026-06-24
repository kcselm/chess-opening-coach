/** Small deterministic PRNG (mulberry32). Same seed → same sequence; used so a drill line is
 *  reproducible ("drill again → same line") and tests are deterministic. No Math.random. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one item with probability proportional to `weight`. Falls back to the first item when all
 *  weights are ≤ 0, and null for an empty list. */
export function pickWeighted<T>(items: T[], weight: (t: T) => number, rng: () => number): T | null {
  if (items.length === 0) return null;
  const total = items.reduce((s, it) => s + Math.max(0, weight(it)), 0);
  if (total <= 0) return items[0]!;
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r < 0) return it;
  }
  return items[items.length - 1]!;
}

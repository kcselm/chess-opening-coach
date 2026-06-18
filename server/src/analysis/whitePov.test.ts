import { describe, it, expect } from "vitest";
import { whitePovCp } from "./whitePov.js";

const W = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const B = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3";

describe("whitePovCp", () => {
  it("keeps white-to-move evals and negates black-to-move evals", () => {
    expect(whitePovCp(W, { scoreCp: 30, mateIn: null })).toBe(30);
    expect(whitePovCp(B, { scoreCp: 30, mateIn: null })).toBe(-30);
  });
  it("returns null for an absent or both-null row", () => {
    expect(whitePovCp(W, undefined)).toBeNull();
    expect(whitePovCp(W, { scoreCp: null, mateIn: null })).toBeNull();
  });
});

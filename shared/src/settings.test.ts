import { describe, it, expect } from "vitest";
import { Settings, DEFAULT_SETTINGS, parseSettings, drillTuningFromSettings } from "./settings.js";

describe("DEFAULT_SETTINGS", () => {
  it("is a valid Settings value", () => {
    expect(() => Settings.parse(DEFAULT_SETTINGS)).not.toThrow();
    expect(DEFAULT_SETTINGS.engine.depth).toBe(18);
    expect(DEFAULT_SETTINGS.thresholds).toEqual({ inaccuracy: 50, mistake: 100, blunder: 200 });
  });
});

describe("parseSettings", () => {
  it("returns the defaults for an empty/undefined blob", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("merges a partial stored blob over the defaults (missing fields fall back)", () => {
    const merged = parseSettings({ engine: { depth: 22 } });
    expect(merged.engine.depth).toBe(22);       // overridden
    expect(merged.engine.threads).toBe(4);      // default filled
    expect(merged.thresholds.mistake).toBe(100); // untouched group defaulted
  });

  it("throws on a value that violates the schema (non-increasing thresholds)", () => {
    expect(() => parseSettings({ thresholds: { inaccuracy: 100, mistake: 50, blunder: 200 } })).toThrow();
  });
});

describe("drillTuningFromSettings", () => {
  it("maps the drill group onto a DrillTuning", () => {
    expect(drillTuningFromSettings(DEFAULT_SETTINGS)).toEqual({
      buckets: { fail: 2, pass: 4, best: 5 },
      ease: { start: 2.5, floor: 1.3 },
    });
  });
});

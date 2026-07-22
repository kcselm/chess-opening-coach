import { z } from "zod";
import { TimeClass } from "./schemas.js";
import type { DrillTuning } from "./srs.js";

export const Settings = z.object({
  engine: z.object({
    depth:    z.number().int().min(6).max(30),
    multipv:  z.number().int().min(1).max(10),
    threads:  z.number().int().min(1).max(64),
    maxPlies: z.number().int().min(4).max(60),     // opening-phase boundary (was MAX_PLIES=30)
  }),
  thresholds: z.object({                            // cp-loss classification labels
    inaccuracy: z.number().int().min(1),
    mistake:    z.number().int().min(1),
    blunder:    z.number().int().min(1),
  }).refine((t) => t.inaccuracy < t.mistake && t.mistake < t.blunder, {
    message: "thresholds must be strictly increasing (inaccuracy < mistake < blunder)",
  }),
  drill: z.object({
    gradeFail: z.number().int().min(0).max(5),      // 2 (lapse, q<3)
    gradePass: z.number().int().min(0).max(5),      // 4 (in-book pass with loss)
    gradeBest: z.number().int().min(0).max(5),      // 5 (best move, cpLoss 0)
    efStart:   z.number().min(1.3),                 // 2.5
    efFloor:   z.number().min(1.0),                 // 1.3
  }),
  sync: z.object({
    source:      z.enum(["chesscom", "lichess"]),
    timeClasses: z.array(TimeClass).min(1),
    sinceDays:   z.number().int().min(1).max(3650), // Dashboard look-back window (was hardcoded 90)
  }),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  engine: { depth: 18, multipv: 3, threads: 4, maxPlies: 30 },
  thresholds: { inaccuracy: 50, mistake: 100, blunder: 200 },
  drill: { gradeFail: 2, gradePass: 4, gradeBest: 5, efStart: 2.5, efFloor: 1.3 },
  sync: { source: "chesscom", timeClasses: ["rapid", "blitz", "classical"], sinceDays: 90 },
};

/** Merge an arbitrary stored value over the defaults, group by group, then validate. A blob written
 *  before a field existed still parses — the default fills the gap. Throws on an invalid value
 *  (surfaces rather than silently falling back). */
export function parseSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Record<keyof Settings, Record<string, unknown>>>;
  return Settings.parse({
    engine:     { ...DEFAULT_SETTINGS.engine,     ...(r.engine ?? {}) },
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(r.thresholds ?? {}) },
    drill:      { ...DEFAULT_SETTINGS.drill,      ...(r.drill ?? {}) },
    sync:       { ...DEFAULT_SETTINGS.sync,       ...(r.sync ?? {}) },
  });
}

/** Project the drill group onto the scheduler's DrillTuning shape. */
export function drillTuningFromSettings(s: Settings): DrillTuning {
  return {
    buckets: { fail: s.drill.gradeFail, pass: s.drill.gradePass, best: s.drill.gradeBest },
    ease: { start: s.drill.efStart, floor: s.drill.efFloor },
  };
}

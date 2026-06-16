export function toEpd(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export const MATE_CP = 100000;

export function scoreToCp(s: { scoreCp: number | null; mateIn: number | null }): number {
  if (s.scoreCp !== null) return s.scoreCp;
  if (s.mateIn !== null) {
    const mag = MATE_CP - Math.abs(s.mateIn);
    return s.mateIn > 0 ? mag : -mag;
  }
  // A UCI engine always reports exactly one of cp/mate. Both null means bad data — fail loud
  // rather than returning a plausible-looking 0 that would silently corrupt cp-loss math.
  throw new Error("scoreToCp: exactly one of scoreCp or mateIn must be non-null");
}

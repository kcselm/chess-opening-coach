import { Chess } from "chess.js";

/** SAN of the engine's top move (first PV, first uci) for `fen`, or null if absent/illegal. */
export function bestMoveSan(fen: string, lines: { pvUci: string[] }[]): string | null {
  const bestUci = lines[0]?.pvUci[0];
  if (!bestUci) return null;
  try {
    const chess = new Chess(fen);
    const mv = chess.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4),
      promotion: bestUci.slice(4, 5) || undefined });
    return mv.san;
  } catch { return null; }
}

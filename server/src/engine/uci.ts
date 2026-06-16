export interface InfoLine {
  depth: number;
  rank: number;
  scoreCp: number | null;
  mateIn: number | null;
  pvUci: string[];
}

export function parseInfoLine(line: string): InfoLine | null {
  if (!line.startsWith("info ")) return null;
  if (!line.includes(" pv ") || !line.includes(" score ")) return null; // skip "info string", currmove, etc.
  const tok = line.split(/\s+/);
  const num = (key: string): number | null => {
    const i = tok.indexOf(key);
    return i >= 0 && i + 1 < tok.length ? Number(tok[i + 1]) : null;
  };
  const depth = num("depth");
  const rank = num("multipv") ?? 1;
  const scoreIdx = tok.indexOf("score");
  let scoreCp: number | null = null;
  let mateIn: number | null = null;
  if (scoreIdx >= 0) {
    const kind = tok[scoreIdx + 1];
    const val = Number(tok[scoreIdx + 2]);
    if (kind === "cp") scoreCp = val;
    else if (kind === "mate") mateIn = val;
  }
  const pvIdx = tok.indexOf("pv");
  const pvUci = pvIdx >= 0 ? tok.slice(pvIdx + 1) : [];
  if (depth === null) return null;
  return { depth, rank, scoreCp, mateIn, pvUci };
}

export function parseBestMove(line: string): string | null {
  if (!line.startsWith("bestmove ")) return null;
  const m = line.split(/\s+/)[1];
  return m && m !== "(none)" ? m : null;
}

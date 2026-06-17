import { Chess } from "chess.js";
import type { ReviewMove, EngineLine } from "@coc/shared";
import { ClassificationChip } from "./ClassificationChip.js";

function firstSan(fen: string, line: EngineLine): string {
  const uci = line.pvUci[0];
  if (!uci) return "";
  try {
    const chess = new Chess(fen);
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined }).san;
  } catch { return ""; }
}

function cpLabel(line: EngineLine): string {
  if (line.mateIn !== null) return `#${line.mateIn}`;
  const cp = (line.scoreCp ?? 0) / 100;
  return cp >= 0 ? `+${cp.toFixed(2)}` : cp.toFixed(2);
}

export function PositionPanel({ move }: { move: ReviewMove }) {
  return (
    <div style={{ minWidth: 200 }}>
      <p>You played <b>{move.san}</b>
        <ClassificationChip classification={move.classification} bookStatus={move.bookStatus} />
      </p>
      {move.betterMoveSan && move.classification !== "best" && move.classification !== "book" &&
        <p style={{ color: "#27ae60" }}>Engine prefers <b>{move.betterMoveSan}</b></p>}
      <h4 style={{ margin: "8px 0 4px" }}>Engine</h4>
      {move.engineLines.length === 0 ? <p style={{ color: "#888" }}>No engine eval cached.</p> : (
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {move.engineLines.map((l) => (
            <li key={l.rank}>{firstSan(move.fenBefore, l)} <span style={{ color: "#888" }}>{cpLabel(l)}</span></li>
          ))}
        </ul>
      )}
      {move.bookMoves.length > 0 && (
        <>
          <h4 style={{ margin: "8px 0 4px" }}>Book ({move.bookTotal})</h4>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {move.bookMoves.slice(0, 5).map((b) => <li key={b.san}>{b.san} <span style={{ color: "#888" }}>{b.count}</span></li>)}
          </ul>
        </>
      )}
    </div>
  );
}

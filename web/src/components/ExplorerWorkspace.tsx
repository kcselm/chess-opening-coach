import type { ReactNode } from "react";
import { Chessboard } from "./Chessboard.js";
import { EvalBar } from "./EvalBar.js";
import { ExplorerMoveTable, type ExplorerRow } from "./ExplorerMoveTable.js";

export function ExplorerWorkspace({
  fen, evalWhiteCp, rows, path, onSelectMove, onNavigate, onReset,
  allowFreeMove = false, onPlayMove, dests, movableColor, controls, detail,
}: {
  fen: string; evalWhiteCp: number | null; rows: ExplorerRow[];
  path: string[]; onSelectMove: (uci: string) => void;
  onNavigate: (index: number) => void; onReset: () => void;
  allowFreeMove?: boolean; onPlayMove?: (orig: string, dest: string) => void;
  dests?: Map<string, string[]>; movableColor?: "white" | "black";
  controls?: ReactNode; detail?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <EvalBar cp={evalWhiteCp ?? 0} />
        <Chessboard fen={fen} onMove={allowFreeMove ? onPlayMove : undefined} dests={dests} movableColor={movableColor} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {controls}
        <div data-testid="breadcrumb" style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 280 }}>
          <button onClick={onReset} style={{ cursor: "pointer" }}>start</button>
          {path.map((san, i) => (
            <button key={i} data-testid={"crumb-" + i} onClick={() => onNavigate(i)} style={{ cursor: "pointer" }}>{san}</button>
          ))}
        </div>
        <ExplorerMoveTable rows={rows} onSelect={onSelectMove} />
        {detail}
      </div>
    </div>
  );
}

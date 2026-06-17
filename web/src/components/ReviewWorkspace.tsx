import { useEffect, useState } from "react";
import type { GameReview } from "@coc/shared";
import { Chessboard, type BoardArrow } from "./Chessboard.js";
import { EvalBar } from "./EvalBar.js";
import { MoveList } from "./MoveList.js";
import { EvalGraph } from "./EvalGraph.js";
import { PositionPanel } from "./PositionPanel.js";

const ARROW_BRUSH: Record<string, BoardArrow["brush"]> = {
  best: "green", book: "blue", inaccuracy: "green", mistake: "red", blunder: "red",
};

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

export function ReviewWorkspace({ review, initialPly }: { review: GameReview; initialPly?: number }) {
  const n = review.moves.length;
  const [selected, setSelected] = useState(clamp(initialPly ?? 0, 0, n));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setSelected((s) => clamp(s + 1, 0, n));
      else if (e.key === "ArrowLeft") setSelected((s) => clamp(s - 1, 0, n));
      else if (e.key === "Home") setSelected(0);
      else if (e.key === "End") setSelected(n);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n]);

  const current = selected > 0 ? review.moves[selected - 1]! : null;
  const fen = current ? current.fenAfter : (review.moves[0]?.fenBefore ?? "start");
  const evalCp = current ? current.evalAfterWhiteCp : (review.moves[0]?.evalBeforeWhiteCp ?? null);
  const arrows: BoardArrow[] = current
    ? [{ orig: current.uci.slice(0, 2), dest: current.uci.slice(2, 4),
        brush: (current.classification && ARROW_BRUSH[current.classification]) ?? "green" }]
    : [];
  const points = [review.moves[0]?.evalBeforeWhiteCp ?? null, ...review.moves.map((m) => m.evalAfterWhiteCp)];

  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <EvalBar cp={evalCp ?? 0} />
        <div>
          <Chessboard fen={fen} arrows={arrows} />
          <div data-testid="ply-indicator" style={{ marginTop: 4, color: "#666" }}>{selected}/{n}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <EvalGraph points={points} selected={selected} onSelect={setSelected} />
        <MoveList moves={review.moves} selected={selected} onSelect={setSelected} />
      </div>
      {current && <PositionPanel move={current} />}
    </div>
  );
}

import type { ReviewMove } from "@coc/shared";
import { ClassificationChip } from "./ClassificationChip.js";

/** `selected` is the number of plies played (1..N); the highlighted move is moves[selected-1]. */
export function MoveList({ moves, selected, onSelect }:
  { moves: ReviewMove[]; selected: number; onSelect: (index: number) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 280 }}>
      {moves.map((m, i) => {
        const isWhite = i % 2 === 0;
        const isCurrent = selected === i + 1;
        return (
          <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
            {isWhite && <b style={{ marginRight: 4, color: "#888" }}>{i / 2 + 1}.</b>}
            <button data-testid={"move-" + i} onClick={() => onSelect(i + 1)}
              style={{ background: isCurrent ? "#dde3ff" : "transparent", border: "none",
                cursor: "pointer", padding: "2px 4px", fontWeight: isCurrent ? 700 : 400 }}>
              {m.san}
              <ClassificationChip classification={m.classification} bookStatus={m.bookStatus} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

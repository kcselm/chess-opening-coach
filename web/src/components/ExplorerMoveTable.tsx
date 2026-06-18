import type { Classification } from "@coc/shared";
import { ClassificationChip } from "./ClassificationChip.js";

export interface ExplorerRow {
  san: string; uci: string; count: number;
  white: number; draws: number; black: number;
  isMine?: boolean; classification?: Classification | null; avgCpLoss?: number | null;
}

export function ExplorerMoveTable({ rows, onSelect }: { rows: ExplorerRow[]; onSelect: (uci: string) => void }) {
  if (rows.length === 0) return <p style={{ color: "#888" }}>No moves from this position.</p>;
  return (
    <table style={{ borderCollapse: "collapse", width: 280 }}>
      <tbody>
        {rows.map((r) => {
          const total = r.white + r.draws + r.black || 1;
          return (
            <tr key={r.uci} data-testid={"move-row-" + r.uci} onClick={() => onSelect(r.uci)} style={{ cursor: "pointer" }}>
              <td style={{ fontWeight: 600, padding: "2px 6px" }}>
                {r.san}
                {r.classification && <ClassificationChip classification={r.classification} bookStatus={null} />}
              </td>
              <td style={{ padding: "2px 6px", color: "#888" }}>{r.count}</td>
              <td style={{ width: 120 }}>
                <div style={{ display: "flex", height: 10, width: 120, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${(r.white / total) * 100}%`, background: "#eee" }} />
                  <div style={{ width: `${(r.draws / total) * 100}%`, background: "#999" }} />
                  <div style={{ width: `${(r.black / total) * 100}%`, background: "#333" }} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

import { Link } from "@tanstack/react-router";
import type { Color } from "@coc/shared";
import type { DrillApi } from "../hooks/useDrill.js";
import { Chessboard } from "./Chessboard.js";
import { EvalBar } from "./EvalBar.js";

export function DrillWorkspace({ drill, color, onAgain, onBack }: {
  drill: DrillApi; color: Color; onAgain: () => void; onBack: () => void;
}) {
  const done = drill.status === "done";
  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <EvalBar cp={drill.evalWhiteCp} />
        <Chessboard
          fen={drill.fen} orientation={color} movableColor={drill.movableColor} dests={drill.dests}
          onMove={drill.movableColor ? (o, d) => void drill.playMove(o, d) : undefined}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 260 }}>
        {/* top: live feedback + accuracy */}
        <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
          <span>{done ? "Line complete" : drill.movableColor ? "Your move" : "Opponent…"}</span>
          <b data-testid="accuracy">{drill.correct}/{drill.total}</b>
        </div>

        {drill.feedback && !done && (
          <div style={{ padding: 8, borderLeft: "3px solid #e5534b", background: "#fdeceb" }}>
            <b>Not in book.</b> Better: {drill.feedback.betterSans.join(" / ")}
          </div>
        )}

        {done && (
          <div style={{ padding: 8, border: "1px solid #ddd", borderRadius: 6 }}>
            <div>First-try accuracy: <b>{drill.correct}/{drill.total}</b></div>
            {drill.missed.length > 0 && (
              <ul style={{ paddingLeft: 16 }}>
                {drill.missed.map((m) => (
                  <li key={m.epd}>
                    <Link to="/study" search={{ epd: m.epd }}>{m.betterSan ?? "review"} — study this</Link>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={onAgain}>Drill again</button>
              <button onClick={onBack}>Back to recommendations</button>
            </div>
          </div>
        )}

        {/* bottom: book theory stays visible while drilling (learn-as-you-go) */}
        {!drill.feedback && (
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888" }}>Theory from here</div>
            <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {drill.bookMoves.map((b) => {
                  const pct = drill.bookMoves.reduce((s, x) => s + x.count, 0);
                  return (
                    <tr key={b.uci}>
                      <td style={{ padding: "2px 8px 2px 0" }}>{b.san}</td>
                      <td style={{ padding: "2px 0", color: "#888" }}>{pct ? Math.round((b.count / pct) * 100) : 0}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div data-testid="line" style={{ fontSize: 12, color: "#888", maxWidth: 280 }}>{drill.lineSan.join(" ")}</div>
      </div>
    </div>
  );
}

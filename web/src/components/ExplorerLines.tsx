import type { Leak } from "@coc/shared";
import { Chessboard } from "./Chessboard.js";

export function LeakDetail({ leak }: { leak: Leak }) {
  return (
    <div data-testid="leak-detail" style={{ display: "flex", gap: 16, padding: 12, background: "#f5f6ff" }}>
      <Chessboard fen={leak.fenBefore} size={200} />
      <div>
        <p>You played <b style={{ color: "#c0392b" }}>{leak.yourMoveSan}</b> ({leak.occurrences}&times;).</p>
        {leak.betterMoveSan && <p>Engine prefers <b style={{ color: "#27ae60" }}>{leak.betterMoveSan}</b>.</p>}
        <p>Average loss: {(leak.avgCpLoss / 100).toFixed(2)} &middot; Score {Math.round(leak.scorePct)}% &middot; {leak.bookStatus}</p>
      </div>
    </div>
  );
}

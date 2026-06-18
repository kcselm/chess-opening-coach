import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toEpd, type Leak, type LeakOccurrence } from "@coc/shared";
import { api } from "../api/client.js";
import { Chessboard } from "./Chessboard.js";

export function LeakDetail({ leak }: { leak: Leak }) {
  const epd = toEpd(leak.fenBefore);
  const { data: occ = [] } = useQuery({
    queryKey: ["occurrences", epd, leak.yourMoveSan],
    queryFn: async () =>
      (await (await api.leaks.occurrences.$get({ query: { epd, san: leak.yourMoveSan } })).json()) as LeakOccurrence[],
  });

  return (
    <div data-testid="leak-detail" style={{ display: "flex", gap: 16, padding: 12, background: "#f5f6ff" }}>
      <Chessboard fen={leak.fenBefore} size={200} />
      <div>
        <p>You played <b style={{ color: "#c0392b" }}>{leak.yourMoveSan}</b> ({leak.occurrences}&times;).</p>
        {leak.betterMoveSan && <p>Engine prefers <b style={{ color: "#27ae60" }}>{leak.betterMoveSan}</b>.</p>}
        <p>Average loss: {(leak.avgCpLoss / 100).toFixed(2)} &middot; Score {Math.round(leak.scorePct)}% &middot; {leak.bookStatus}</p>
        {occ.length > 0 && (
          <>
            <h4 style={{ margin: "8px 0 4px" }}>Games</h4>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {occ.map((o) => (
                <li key={o.gameId + ":" + o.ply}>
                  <Link to="/games/$id" params={{ id: o.gameId }} search={{ ply: o.ply }}>
                    {o.openingName ?? "game"} &mdash; {o.result} ({o.myColor})
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <p style={{ marginTop: 8 }}>
          <Link to="/study" search={{ epd }}>Study this position</Link>
        </p>
      </div>
    </div>
  );
}

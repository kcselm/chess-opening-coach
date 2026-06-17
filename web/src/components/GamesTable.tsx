import { useMemo, useState } from "react";
import type { GameSummary, GameResult, Color } from "@coc/shared";

export function GamesTable({ games, onOpen }: { games: GameSummary[]; onOpen: (id: string) => void }) {
  const [result, setResult] = useState<GameResult | "all">("all");
  const [color, setColor] = useState<Color | "all">("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => games
    .filter((g) => result === "all" || g.result === result)
    .filter((g) => color === "all" || g.myColor === color)
    .filter((g) => !q || (g.openingName ?? "").toLowerCase().includes(q.toLowerCase()))
    .slice()
    .sort((a, b) => b.endTime - a.endTime), [games, result, color, q]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <select aria-label="result filter" value={result} onChange={(e) => setResult(e.target.value as GameResult | "all")}>
          <option value="all">all results</option><option value="win">win</option>
          <option value="loss">loss</option><option value="draw">draw</option>
        </select>
        <select aria-label="color filter" value={color} onChange={(e) => setColor(e.target.value as Color | "all")}>
          <option value="all">both colors</option><option value="white">white</option><option value="black">black</option>
        </select>
        <input placeholder="opening" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
          <th>Opening</th><th>Color</th><th>Result</th><th>Time</th></tr></thead>
        <tbody>
          {rows.map((gm) => (
            <tr key={gm.id} onClick={() => onOpen(gm.id)} style={{ cursor: "pointer", borderBottom: "1px solid #eee" }}>
              <td>{gm.openingName ?? "Unknown opening"}</td><td>{gm.myColor}</td>
              <td>{gm.result}</td><td>{gm.timeClass}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

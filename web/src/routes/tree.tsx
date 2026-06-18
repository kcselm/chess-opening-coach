import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { TreeChildren, Color } from "@coc/shared";
import { api } from "../api/client.js";
import { ExplorerWorkspace } from "../components/ExplorerWorkspace.js";
import type { ExplorerRow } from "../components/ExplorerMoveTable.js";

const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const fenForEpd = (epd: string) => `${epd} 0 1`;

export function TreePage() {
  const [color, setColor] = useState<Color>("white");
  const [path, setPath] = useState<{ san: string; epd: string }[]>([]);
  const epd = path.length ? path[path.length - 1]!.epd : START_EPD;

  const { data: tree } = useQuery({
    queryKey: ["tree", color, epd],
    queryFn: async () => (await (await api.tree.$get({ query: { color, epd } })).json()) as TreeChildren,
  });

  const rows: ExplorerRow[] = (tree?.children ?? []).map((c) => ({
    san: c.san, uci: c.uci, count: c.count, white: c.white, draws: c.draws, black: c.black,
    isMine: c.isMine, classification: c.classification, avgCpLoss: c.avgCpLoss,
  }));

  function descend(uci: string) {
    const child = tree?.children.find((c) => c.uci === uci);
    if (child) setPath((p) => [...p, { san: child.san, epd: child.epdAfter }]);
  }

  const controls = (
    <select aria-label="repertoire color" value={color}
      onChange={(e) => { setColor(e.target.value as Color); setPath([]); }}>
      <option value="white">white</option>
      <option value="black">black</option>
    </select>
  );

  const detail = <p><Link to="/study" search={{ epd }}>Study this position</Link></p>;

  return (
    <div>
      <h1>Tree</h1>
      <ExplorerWorkspace
        fen={fenForEpd(epd)} evalWhiteCp={null} rows={rows} path={path.map((n) => n.san)}
        onSelectMove={descend} onNavigate={(i) => setPath((p) => p.slice(0, i + 1))} onReset={() => setPath([])}
        controls={controls} detail={detail}
      />
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OpeningListItem } from "@coc/shared";
import { api } from "../api/client.js";

export function OpeningPicker({ onPick }: { onPick: (o: OpeningListItem) => void }) {
  const [q, setQ] = useState("");
  const { data: results = [] } = useQuery({
    queryKey: ["openings", q],
    enabled: q.trim().length >= 2,
    queryFn: async () => (await (await api.openings.$get({ query: { q } })).json()) as OpeningListItem[],
  });
  return (
    <div>
      <input placeholder="search openings" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul style={{ listStyle: "none", padding: 0, maxWidth: 360 }}>
        {results.map((o) => (
          <li key={o.epd}>
            <button data-testid={"opening-" + o.epd} onClick={() => onPick(o)} style={{ cursor: "pointer" }}>
              <b>{o.eco}</b> {o.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

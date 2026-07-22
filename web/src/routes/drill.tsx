import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { DEFAULT_MAX_CP_LOSS, type DrillRecommendation, type Color, type BookSource } from "@coc/shared";
import { api } from "../api/client.js";
import { OpeningPicker } from "../components/OpeningPicker.js";
import { DrillWorkspace } from "../components/DrillWorkspace.js";
import { useDrill } from "../hooks/useDrill.js";

interface Selection { epd: string; name: string | null }

export function DrillPage() {
  const search = useSearch({ from: "/drill" });
  const [sel, setSel] = useState<Selection | null>(search.epd ? { epd: search.epd, name: null } : null);
  const [color, setColor] = useState<Color>(search.color ?? "white");
  const [source, setSource] = useState<BookSource>(search.source ?? "rating");
  const [seedKey, setSeedKey] = useState(0); // bump to remount the drill for a fresh line

  if (sel) {
    return <DrillRun key={seedKey} epd={sel.epd} name={sel.name} color={color} source={source}
      onAgain={() => setSeedKey((k) => k + 1)} onBack={() => setSel(null)} />;
  }

  return (
    <div>
      <h1>Drill</h1>
      <div style={{ display: "flex", gap: 12, margin: "8px 0" }}>
        <label>color{" "}
          <select aria-label="color" value={color} onChange={(e) => setColor(e.target.value as Color)}>
            <option value="white">white</option><option value="black">black</option>
          </select>
        </label>
        <label>book{" "}
          <select aria-label="book source" value={source} onChange={(e) => setSource(e.target.value as BookSource)}>
            <option value="rating">my rating</option><option value="masters">masters</option>
          </select>
        </label>
      </div>

      <Recommended onPick={(r) => setSel({ epd: r.openingEpd, name: r.openingName })} />

      <h3 style={{ marginTop: 16 }}>Or pick any opening</h3>
      <OpeningPicker onPick={(o) => setSel({ epd: o.epd, name: o.name })} />
    </div>
  );
}

function Recommended({ onPick }: { onPick: (r: DrillRecommendation) => void }) {
  const { data: recs = [] } = useQuery({
    queryKey: ["drill-recommended"],
    queryFn: async () => (await (await api.drill.recommended.$get()).json()) as DrillRecommendation[],
  });
  if (recs.length === 0) return <p>No recommendations yet — sync some games, or pick an opening below.</p>;
  const dueTotal = recs.filter((r) => r.reason === "due").reduce((s, r) => s + r.score, 0);
  return (
    <>
      {dueTotal > 0 && (
        <p style={{ fontSize: 12, color: "#555", margin: "4px 0" }}>{dueTotal} positions due</p>
      )}
      <ul style={{ listStyle: "none", padding: 0, maxWidth: 420 }}>
        {recs.map((r) => (
          <li key={r.openingEpd} style={{ margin: "4px 0" }}>
            <button onClick={() => onPick(r)} style={{ cursor: "pointer", textAlign: "left", width: "100%" }}>
              <span style={{ fontSize: 11, textTransform: "uppercase", background: "#eee", padding: "1px 6px", borderRadius: 4, marginRight: 8 }}>{r.reason}</span>
              <b>{r.eco ?? ""}</b> {r.openingName}
              {r.reason === "due" && <span style={{ marginLeft: 6, color: "#777" }}>· {r.score} due</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function DrillRun({ epd, name, color, source, onAgain, onBack }: {
  epd: string; name: string | null; color: Color; source: BookSource; onAgain: () => void; onBack: () => void;
}) {
  const drill = useDrill({ rootEpd: epd, color, source, maxCpLoss: DEFAULT_MAX_CP_LOSS, openingName: name });
  return (
    <div>
      <h1>Drill{name ? ` — ${name}` : ""}</h1>
      <DrillWorkspace drill={drill} color={color} onAgain={onAgain} onBack={onBack} />
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Leak } from "@coc/shared";
import { api } from "../api/client.js";
import { LeakDetail } from "../components/ExplorerLines.js";

export function LeaksPage() {
  const { data: leaks = [], isLoading } = useQuery({
    queryKey: ["leaks"],
    queryFn: async () => (await (await api.leaks.$get()).json()) as Leak[],
  });
  const [open, setOpen] = useState<number | null>(null);

  if (isLoading) return <p>Loading leaks&hellip;</p>;
  if (!leaks.length) return <p>No leaks yet &mdash; run a sync from the Dashboard.</p>;

  return (
    <div>
      <h1>Leak report</h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
            <th>Opening</th><th>You play</th><th>Better</th><th>&times;</th><th>Avg loss</th><th>Score</th>
          </tr>
        </thead>
        <tbody>
          {leaks.map((leak, i) => (
            <FragmentRow key={i} leak={leak} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({ leak, open, onToggle }: { leak: Leak; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", borderBottom: "1px solid #eee" }}>
        <td>{leak.openingName}</td>
        <td style={{ color: "#c0392b" }}>{leak.yourMoveSan}</td>
        <td style={{ color: "#27ae60" }}>{leak.betterMoveSan ?? "&mdash;"}</td>
        <td>{leak.occurrences}</td>
        <td>&minus;{(leak.avgCpLoss / 100).toFixed(2)}</td>
        <td>{Math.round(leak.scorePct)}%</td>
      </tr>
      {open && (
        <tr><td colSpan={6} style={{ padding: 0 }}><LeakDetail leak={leak} /></td></tr>
      )}
    </>
  );
}

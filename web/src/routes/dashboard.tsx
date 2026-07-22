import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_SETTINGS, type Settings } from "@coc/shared";
import { api } from "../api/client.js";
import { SyncProgress } from "../components/SyncProgress.js";

type Source = "chesscom" | "lichess";
const SOURCE_LABELS: Record<Source, string> = { chesscom: "chess.com", lichess: "Lichess" };

export function DashboardPage() {
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await (await api.settings.$get()).json()) as Settings,
  });
  const s = settings ?? DEFAULT_SETTINGS;

  const [sourceOverride, setSourceOverride] = useState<Source | null>(null);
  const [username, setUsername] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const source = sourceOverride ?? s.sync.source;

  async function startSync() {
    const now = Math.floor(Date.now() / 1000);
    const res = await api.sync.$post({
      json: { source, username, since: now - s.sync.sinceDays * 86400, until: now,
        timeClasses: s.sync.timeClasses },
    });
    const { runId } = (await res.json()) as { runId: string };
    setRunId(runId);
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Analyze the last {s.sync.sinceDays} days of your games.</p>
      <select aria-label="Source" value={source} onChange={(e) => setSourceOverride(e.target.value as Source)}>
        <option value="chesscom">chess.com</option>
        <option value="lichess">Lichess</option>
      </select>
      <input placeholder={`${SOURCE_LABELS[source]} username`} value={username}
        onChange={(e) => setUsername(e.target.value)} />
      <button onClick={startSync} disabled={!username}>Sync &amp; analyze</button>
      {runId && <SyncProgress runId={runId} />}
    </div>
  );
}

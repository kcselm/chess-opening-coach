import { useState } from "react";
import { api } from "../api/client.js";
import { SyncProgress } from "../components/SyncProgress.js";

type Source = "chesscom" | "lichess";
const SOURCE_LABELS: Record<Source, string> = { chesscom: "chess.com", lichess: "Lichess" };

export function DashboardPage() {
  const [source, setSource] = useState<Source>("chesscom");
  const [username, setUsername] = useState("");
  const [runId, setRunId] = useState<string | null>(null);

  async function startSync() {
    const now = Math.floor(Date.now() / 1000);
    const res = await api.sync.$post({
      json: { source, username, since: now - 60 * 60 * 24 * 90, until: now,
        timeClasses: ["rapid", "blitz", "classical"] },
    });
    const { runId } = (await res.json()) as { runId: string };
    setRunId(runId);
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Analyze the last 90 days of your games.</p>
      <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as Source)}>
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

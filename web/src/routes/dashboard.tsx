import { useState } from "react";
import { api } from "../api/client.js";
import { SyncProgress } from "../components/SyncProgress.js";

export function DashboardPage() {
  const [username, setUsername] = useState("");
  const [runId, setRunId] = useState<string | null>(null);

  async function startSync() {
    const now = Math.floor(Date.now() / 1000);
    const res = await api.sync.$post({
      json: { source: "chesscom", username, since: now - 60 * 60 * 24 * 90, until: now,
        timeClasses: ["rapid", "blitz", "classical"] },
    });
    const { runId } = (await res.json()) as { runId: string };
    setRunId(runId);
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Analyze the last 90 days of your chess.com games.</p>
      <input placeholder="chess.com username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <button onClick={startSync} disabled={!username}>Sync &amp; analyze</button>
      {runId && <SyncProgress runId={runId} />}
    </div>
  );
}

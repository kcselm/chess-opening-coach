import { useEffect, useState } from "react";
import type { SyncProgress as Progress } from "@coc/shared";

export function SyncProgress({ runId }: { runId: string }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    const es = new EventSource(`/api/sync/${runId}/progress`);
    es.onmessage = (e) => {
      const p = JSON.parse(e.data) as Progress;
      setProgress(p);
      if (p.phase === "done" || p.phase === "error") es.close();
    };
    return () => es.close();
  }, [runId]);

  if (!progress) return <p>Starting&hellip;</p>;
  return (
    <div>
      <p><b>{progress.phase}</b></p>
      <p>Games fetched: {progress.gamesFetched}</p>
      <p>Positions analyzed: {progress.positionsAnalyzed}{progress.positionsTotal ? ` / ${progress.positionsTotal}` : ""}</p>
      {progress.message && <p style={{ color: "crimson" }}>{progress.message}</p>}
    </div>
  );
}

import type { SyncProgress } from "@coc/shared";

export class RunStore {
  private runs = new Map<string, SyncProgress>();
  private listeners = new Map<string, Set<(p: SyncProgress) => void>>();
  private counter = 0;

  create(): string {
    const runId = `run_${++this.counter}`;
    this.runs.set(runId, {
      runId,
      phase: "fetching",
      gamesFetched: 0,
      gamesTotal: null,
      positionsAnalyzed: 0,
      positionsTotal: null,
    });
    this.listeners.set(runId, new Set());
    return runId;
  }

  get(runId: string): SyncProgress | undefined {
    return this.runs.get(runId);
  }

  update(runId: string, patch: Partial<SyncProgress>) {
    const cur = this.runs.get(runId);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.runs.set(runId, next);
    for (const l of this.listeners.get(runId) ?? []) l(next);
  }

  subscribe(runId: string, fn: (p: SyncProgress) => void): () => void {
    this.listeners.get(runId)?.add(fn);
    return () => this.listeners.get(runId)?.delete(fn);
  }
}

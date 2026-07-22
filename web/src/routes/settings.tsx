import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Settings, TimeClass } from "@coc/shared";
import { api } from "../api/client.js";

const TIME_CLASSES: TimeClass[] = ["bullet", "blitz", "rapid", "classical", "daily"];

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await (await api.settings.$get()).json()) as Settings,
  });
  const [form, setForm] = useState<Settings | null>(null);
  const save = useMutation({
    mutationFn: async (next: Settings) => (await (await api.settings.$put({ json: next })).json()) as Settings,
    onSuccess: (saved) => { qc.setQueryData(["settings"], saved); setForm(null); },
  });

  const current = form ?? data ?? null;
  if (isLoading || !current) return <p>Loading settings&hellip;</p>;

  const s = current;
  const dirty = form !== null;
  const patch = (p: Partial<Settings>) => setForm({ ...s, ...p });

  return (
    <div>
      <h1>Settings</h1>
      <p style={{ color: "#555", maxWidth: 560 }}>
        Changes apply going forward &mdash; existing analysis is not reprocessed. Re-sync to pick up
        engine and threshold changes on games you have already imported.
      </p>

      <section>
        <h2>Engine</h2>
        <Num label="Depth" value={s.engine.depth} min={6} max={30}
          note="Applies to the next sync. Existing evals were cached at the old depth, so the Leak and Review views show only re-analyzed positions until you re-sync."
          onChange={(depth) => patch({ engine: { ...s.engine, depth } })} />
        <Num label="MultiPV (lines)" value={s.engine.multipv} min={1} max={10}
          note="Applies to the next analysis."
          onChange={(multipv) => patch({ engine: { ...s.engine, multipv } })} />
        <Num label="Threads" value={s.engine.threads} min={1} max={64}
          note="Applied at the start of the next sync."
          onChange={(threads) => patch({ engine: { ...s.engine, threads } })} />
        <Num label="Opening-phase plies" value={s.engine.maxPlies} min={4} max={60}
          note="Applies to newly imported games."
          onChange={(maxPlies) => patch({ engine: { ...s.engine, maxPlies } })} />
      </section>

      <section>
        <h2>Classification (centipawn loss)</h2>
        <Num label="Inaccuracy ≥" value={s.thresholds.inaccuracy} min={1} max={1000}
          note="Move chips update on the next sync."
          onChange={(inaccuracy) => patch({ thresholds: { ...s.thresholds, inaccuracy } })} />
        <Num label="Mistake ≥" value={s.thresholds.mistake} min={1} max={1000}
          note="Also the leak cutoff — the Leak report re-ranks immediately."
          onChange={(mistake) => patch({ thresholds: { ...s.thresholds, mistake } })} />
        <Num label="Blunder ≥" value={s.thresholds.blunder} min={1} max={1000}
          note="Move chips update on the next sync."
          onChange={(blunder) => patch({ thresholds: { ...s.thresholds, blunder } })} />
      </section>

      <section>
        <h2>Drill (SM-2)</h2>
        <Num label="Grade: fail" value={s.drill.gradeFail} min={0} max={5} note="Future reviews only."
          onChange={(gradeFail) => patch({ drill: { ...s.drill, gradeFail } })} />
        <Num label="Grade: pass" value={s.drill.gradePass} min={0} max={5} note="Future reviews only."
          onChange={(gradePass) => patch({ drill: { ...s.drill, gradePass } })} />
        <Num label="Grade: best" value={s.drill.gradeBest} min={0} max={5} note="Future reviews only."
          onChange={(gradeBest) => patch({ drill: { ...s.drill, gradeBest } })} />
        <Num label="Ease start" value={s.drill.efStart} min={1.3} max={4} step={0.1} note="New cards only."
          onChange={(efStart) => patch({ drill: { ...s.drill, efStart } })} />
        <Num label="Ease floor" value={s.drill.efFloor} min={1} max={3} step={0.1} note="Future reviews only."
          onChange={(efFloor) => patch({ drill: { ...s.drill, efFloor } })} />
      </section>

      <section>
        <h2>Sync defaults</h2>
        <label style={{ display: "block", margin: "6px 0" }}>
          <span style={{ display: "inline-block", width: 160 }}>Source</span>
          <select value={s.sync.source}
            onChange={(e) => patch({ sync: { ...s.sync, source: e.target.value as "chesscom" | "lichess" } })}>
            <option value="chesscom">chess.com</option>
            <option value="lichess">Lichess</option>
          </select>
        </label>
        <fieldset style={{ margin: "6px 0", maxWidth: 420 }}>
          <legend>Time classes</legend>
          {TIME_CLASSES.map((tc) => (
            <label key={tc} style={{ marginRight: 10 }}>
              <input type="checkbox" checked={s.sync.timeClasses.includes(tc)}
                onChange={(e) => patch({ sync: { ...s.sync,
                  timeClasses: e.target.checked
                    ? [...s.sync.timeClasses, tc]
                    : s.sync.timeClasses.filter((x) => x !== tc) } })} />
              {tc}
            </label>
          ))}
        </fieldset>
        <Num label="Look-back (days)" value={s.sync.sinceDays} min={1} max={3650} note="Prefills the Dashboard."
          onChange={(sinceDays) => patch({ sync: { ...s.sync, sinceDays } })} />
      </section>

      <button onClick={() => save.mutate(s)} disabled={!dirty || save.isPending}>
        {save.isPending ? "Saving…" : "Save"}
      </button>
      {save.isSuccess && !dirty && <span style={{ marginLeft: 8, color: "#27ae60" }}>Saved</span>}
      {save.isError && <span style={{ marginLeft: 8, color: "#c0392b" }}>Save failed — check the values</span>}
    </div>
  );
}

function Num({ label, value, min, max, step, note, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; note?: string; onChange: (n: number) => void;
}) {
  return (
    <label style={{ display: "block", margin: "6px 0" }}>
      <span style={{ display: "inline-block", width: 160 }}>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))} />
      {note && <div style={{ fontSize: 11, color: "#777", marginLeft: 160 }}>{note}</div>}
    </label>
  );
}

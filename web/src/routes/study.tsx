import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Chess } from "chess.js";
import { toEpd, type ExploreResult, type PositionAnalysis, type BookSource } from "@coc/shared";
import { api } from "../api/client.js";
import { ExplorerWorkspace } from "../components/ExplorerWorkspace.js";
import { OpeningPicker } from "../components/OpeningPicker.js";
import type { ExplorerRow } from "../components/ExplorerMoveTable.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const fenForEpd = (epd: string) => `${epd} 0 1`;

export function StudyPage() {
  const search = useSearch({ from: "/study" });
  const [pickedEpd, setPickedEpd] = useState<string | null>(null);
  const [moves, setMoves] = useState<string[]>([]);
  const [source, setSource] = useState<BookSource>(search.source ?? "masters");

  const rootEpd = search.epd ?? pickedEpd;

  const game = useMemo(() => {
    if (!rootEpd) return null;
    const c = new Chess(fenForEpd(rootEpd));
    for (const san of moves) { try { c.move(san); } catch { break; } }
    return c;
  }, [rootEpd, moves]);

  const fen = game ? game.fen() : START_FEN;
  const epd = game ? toEpd(fen) : "";

  const { data: explore } = useQuery({
    queryKey: ["explore", epd, source],
    enabled: !!game,
    queryFn: async () => (await (await api.explore.$get({ query: { epd, source } })).json()) as ExploreResult,
  });

  const lines = explore?.lines ?? [];

  const qc = useQueryClient();
  const analyze = useMutation({
    mutationFn: async (): Promise<PositionAnalysis | "busy"> => {
      const res = await api.position.$get({ query: { fen } });
      if (res.status === 409) return "busy";
      return (await res.json()) as PositionAnalysis;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["explore", epd, source] }),
  });

  const dests = useMemo(() => {
    const m = new Map<string, string[]>();
    if (game) for (const mv of game.moves({ verbose: true })) {
      const arr = m.get(mv.from) ?? []; arr.push(mv.to); m.set(mv.from, arr);
    }
    return m;
  }, [game]);

  function pushUci(uci: string) {
    if (!game) return;
    const c = new Chess(game.fen());
    const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci.slice(4, 5) || "q") });
    if (mv) setMoves((m) => [...m, mv.san]);
  }

  if (!rootEpd) {
    return (
      <div>
        <h1>Study</h1>
        <OpeningPicker onPick={(o) => { setPickedEpd(o.epd); setMoves([]); }} />
      </div>
    );
  }

  const rows: ExplorerRow[] = (explore?.bookMoves ?? []).map((b) => ({
    san: b.san, uci: b.uci, count: b.count, white: b.white, draws: b.draws, black: b.black,
  }));

  const controls = (
    <select aria-label="book source" value={source} onChange={(e) => setSource(e.target.value as BookSource)}>
      <option value="masters">masters</option>
      <option value="rating">my rating</option>
    </select>
  );

  const detail = (
    <div>
      <button onClick={() => analyze.mutate()} disabled={analyze.isPending}>
        {analyze.isPending ? "Analyzing…" : "Analyze"}
      </button>
      {analyze.data === "busy" && <span style={{ color: "#c0392b", marginLeft: 8 }}>engine busy (sync running)</span>}
      {lines.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>
          {lines.map((l) => (
            <li key={l.rank}>{l.mateIn !== null ? `#${l.mateIn}` : ((l.scoreCp ?? 0) / 100).toFixed(2)} &mdash; {l.pvUci[0]}</li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div>
      <h1>Study</h1>
      <ExplorerWorkspace
        fen={fen} evalWhiteCp={explore?.evalWhiteCp ?? null} rows={rows} path={moves}
        onSelectMove={pushUci} onNavigate={(i) => setMoves((m) => m.slice(0, i + 1))} onReset={() => setMoves([])}
        allowFreeMove onPlayMove={(orig, dest) => pushUci(orig + dest)}
        dests={dests} movableColor={game!.turn() === "w" ? "white" : "black"}
        controls={controls} detail={detail}
      />
    </div>
  );
}

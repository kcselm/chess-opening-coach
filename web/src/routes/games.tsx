import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { GameSummary } from "@coc/shared";
import { api } from "../api/client.js";
import { GamesTable } from "../components/GamesTable.js";

export function GamesPage() {
  const navigate = useNavigate();
  const { data: games = [], isLoading } = useQuery({
    queryKey: ["games"],
    queryFn: async () => (await (await api.games.$get()).json()) as GameSummary[],
  });
  if (isLoading) return <p>Loading games&hellip;</p>;
  if (!games.length) return <p>No games yet &mdash; run a sync from the Dashboard.</p>;
  return (
    <div>
      <h1>Games</h1>
      <GamesTable games={games} onOpen={(id) => navigate({ to: "/games/$id", params: { id } })} />
    </div>
  );
}

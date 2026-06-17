import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import type { GameReview } from "@coc/shared";
import { api } from "../api/client.js";
import { ReviewWorkspace } from "../components/ReviewWorkspace.js";

export function ReviewPage() {
  const { id } = useParams({ from: "/games/$id" });
  const { ply } = useSearch({ from: "/games/$id" });
  const { data, isLoading, isError } = useQuery({
    queryKey: ["game", id],
    queryFn: async () => {
      const res = await api.games[":id"].$get({ param: { id } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("failed to load review");
      return (await res.json()) as GameReview;
    },
  });
  if (isLoading) return <p>Loading review&hellip;</p>;
  if (isError) return <p>Failed to load review.</p>;
  if (!data) return <p>Game not found.</p>;
  return (
    <div>
      <h1>{data.openingName ?? "Unknown opening"} <span style={{ color: "#888", fontSize: 14 }}>({data.result})</span></h1>
      {data.moves.length === 0
        ? <p>This game has no analyzed opening moves.</p>
        : <ReviewWorkspace review={data} initialPly={ply} />}
    </div>
  );
}

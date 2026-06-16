import type { NormalizedGame, TimeClass } from "@coc/shared";

export interface FetchParams {
  username: string;
  since: number;
  until: number;
  timeClasses: TimeClass[];
}

export interface GameSource {
  id: "chesscom" | "lichess";
  fetchGames(params: FetchParams): AsyncIterable<NormalizedGame>;
}

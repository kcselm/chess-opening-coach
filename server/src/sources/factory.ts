import type { GameSource } from "./types.js";
import { ChesscomSource } from "./chesscom.js";
import { LichessSource } from "./lichess.js";

export function sourceFor(source: "chesscom" | "lichess", token?: string): GameSource {
  return source === "lichess" ? new LichessSource(token) : new ChesscomSource();
}

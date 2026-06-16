import { Chess } from "chess.js";
import type { Color } from "@coc/shared";
import { toEpd } from "@coc/shared";

export interface OpeningMove {
  ply: number;
  fenBefore: string;
  fenAfter: string;
  epdBefore: string;
  epdAfter: string;
  san: string;
  uci: string;
  isMine: boolean;
}

export function extractOpeningMoves(pgn: string, myColor: Color, maxPlies: number): OpeningMove[] {
  const replay = new Chess();
  const history = (() => {
    const tmp = new Chess();
    tmp.loadPgn(pgn);
    return tmp.history();
  })();

  const out: OpeningMove[] = [];
  for (let ply = 0; ply < history.length && ply < maxPlies; ply++) {
    const fenBefore = replay.fen();
    const sideToMove: Color = replay.turn() === "w" ? "white" : "black";
    const move = replay.move(history[ply]!);
    const uci = move.from + move.to + (move.promotion ?? "");
    const fenAfter = replay.fen();
    out.push({
      ply,
      fenBefore,
      fenAfter,
      epdBefore: toEpd(fenBefore),
      epdAfter: toEpd(fenAfter),
      san: move.san,
      uci,
      isMine: sideToMove === myColor,
    });
  }
  return out;
}

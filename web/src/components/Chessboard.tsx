import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

export interface BoardArrow { orig: string; dest: string; brush?: "green" | "red" | "blue" }

export function Chessboard({ fen, arrows = [], size = 320 }: { fen: string; arrows?: BoardArrow[]; size?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, { fen, viewOnly: true, coordinates: false });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    api.current?.set({
      fen,
      drawable: { autoShapes: arrows.map((a) => ({ orig: a.orig, dest: a.dest, brush: a.brush ?? "green" })) },
    });
  }, [fen, arrows]);

  return <div ref={el} style={{ width: size, height: size }} />;
}

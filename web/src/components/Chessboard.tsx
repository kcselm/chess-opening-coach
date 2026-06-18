import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

export interface BoardArrow { orig: string; dest: string; brush?: "green" | "red" | "blue" }

export function Chessboard({ fen, arrows = [], size = 320, onMove, dests, movableColor }: {
  fen: string; arrows?: BoardArrow[]; size?: number;
  onMove?: (orig: string, dest: string) => void;
  dests?: Map<string, string[]>; movableColor?: "white" | "black";
}) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, { fen, viewOnly: !onMove, coordinates: false });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    api.current?.set({
      fen,
      viewOnly: !onMove,
      movable: onMove
        ? { free: false, color: movableColor, dests: dests as unknown as Map<Key, Key[]>,
            events: { after: (orig, dest) => onMove(orig as string, dest as string) } }
        : undefined,
      drawable: { autoShapes: arrows.map((a) => ({ orig: a.orig as Key, dest: a.dest as Key, brush: a.brush ?? "green" })) },
    });
  }, [fen, arrows, onMove, dests, movableColor]);

  return <div ref={el} style={{ width: size, height: size }} />;
}

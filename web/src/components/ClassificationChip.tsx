import type { Classification, BookStatus } from "@coc/shared";

const COLORS: Record<Classification, string> = {
  best: "#27ae60", book: "#2980b9", inaccuracy: "#e1a100", mistake: "#e67e22", blunder: "#c0392b",
};

export function ClassificationChip({ classification, bookStatus }:
  { classification: Classification | null; bookStatus: BookStatus | null }) {
  if (!classification) return null;
  const title = bookStatus ? `book: ${bookStatus}` : undefined;
  return (
    <span title={title} style={{ background: COLORS[classification], color: "#fff", borderRadius: 4,
      padding: "0 6px", fontSize: 11, marginLeft: 6 }}>
      {classification}
    </span>
  );
}

export function EvalBar({ cp }: { cp: number | null }) {
  if (cp === null) {
    return (
      <div aria-label="no evaluation" style={{ width: 16, height: 200, background: "#444", borderRadius: 4 }} />
    );
  }
  const whiteShare = 100 / (1 + Math.exp(-cp / 300));
  const pawns = (cp / 100).toFixed(1);
  const label = cp >= 0 ? `+${pawns}` : pawns;
  return (
    <div style={{ width: 16, height: 200, background: "#444", borderRadius: 4, overflow: "hidden",
      display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div data-testid="eval-white" style={{ height: `${whiteShare}%`, background: "#eee" }} />
      <span style={{ fontSize: 10, textAlign: "center" }}>{label}</span>
    </div>
  );
}

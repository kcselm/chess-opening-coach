const W = 280, H = 80, PAD = 4, CLAMP = 600; // cp clamp for the y-axis

function y(cp: number): number {
  const c = Math.max(-CLAMP, Math.min(CLAMP, cp));
  return PAD + (1 - (c + CLAMP) / (2 * CLAMP)) * (H - 2 * PAD);
}

export function EvalGraph({ points, selected, onSelect }:
  { points: (number | null)[]; selected: number; onSelect: (index: number) => void }) {
  const n = points.length;
  const x = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - 2 * PAD));
  const line = points
    .map((cp, i) => (cp === null ? null : `${x(i)},${y(cp)}`))
    .filter((p): p is string => p !== null)
    .join(" ");

  return (
    <svg width={W} height={H} role="img" aria-label="opening eval graph" style={{ background: "#f4f5fb" }}>
      <line x1={PAD} y1={y(0)} x2={W - PAD} y2={y(0)} stroke="#ccc" />
      <polyline points={line} fill="none" stroke="#5566cc" strokeWidth={2} />
      {points.map((cp, i) => (
        <circle key={i} data-testid={"eval-pt-" + i} cx={x(i)} cy={cp === null ? y(0) : y(cp)}
          r={i === selected ? 5 : 3} fill={i === selected ? "#c0392b" : "#5566cc"}
          style={{ cursor: "pointer" }} onClick={() => onSelect(i)} />
      ))}
    </svg>
  );
}

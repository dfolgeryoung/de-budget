import { useState } from "react";
import { formatMoney } from "../budget/money";
import type { Flows, FlowNode } from "../budget/flows";

const whole = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-US");
const COLOR: Record<FlowNode["kind"], string> = { source: "var(--green-solid)", carry: "var(--yellow-text)", income: "var(--ink)", group: "var(--hue-2)", contrib: "var(--hue-4)", saved: "var(--green-solid)" };

/**
 * Three columns: sources → Income → where it went. Hand-drawn SVG so it works offline and matches the theme.
 * On the phone the labels sit on top of the bands instead of beside them, so the drawing keeps its width.
 */
export function Sankey({ flows, phone }: { flows: Flows; phone: boolean }) {
  const [hot, setHot] = useState<string | null>(null);
  const W = phone ? 360 : 900, H = phone ? 420 : 380;
  const labelW = phone ? 0 : 215; // room for the labels beside the outer columns on desktop
  const nodeW = phone ? 10 : 14, gap = phone ? 6 : 10;
  const left = labelW + 4, mid = W / 2 - nodeW / 2, right = W - labelW - nodeW - 4;
  const total = flows.nodes.find((n) => n.id === "income")?.amount ?? 0;
  if (!total) return <p className="text-sm m-0" style={{ color: "var(--muted)" }}>No income has landed this month yet, so there's nothing to draw.</p>;

  const cols: FlowNode[][] = [flows.nodes.filter((n) => n.kind === "source" || n.kind === "carry"), flows.nodes.filter((n) => n.kind === "income"), flows.nodes.filter((n) => n.kind === "group" || n.kind === "contrib" || n.kind === "saved")];
  const usable = (col: FlowNode[]) => H - gap * Math.max(0, col.length - 1) - (phone ? 16 : 0);
  const scale = Math.min(...cols.map((c) => usable(c) / Math.max(1, c.reduce((s, n) => s + n.amount, 0))));
  // y positions: each column stacks from the top, centred vertically
  const pos = new Map<string, { x: number; y: number; h: number; col: number }>();
  cols.forEach((col, ci) => {
    const x = ci === 0 ? left : ci === 1 ? mid : right;
    const totalH = col.reduce((s, n) => s + n.amount * scale, 0) + gap * Math.max(0, col.length - 1);
    let y = (H - totalH) / 2 + (phone ? 8 : 0);
    for (const n of col) { const h = Math.max(2, n.amount * scale); pos.set(n.id, { x, y, h, col: ci }); y += h + gap; }
  });
  // link bands: stack along each node's edge in link order
  const outY = new Map<string, number>(), inY = new Map<string, number>();
  const bands = flows.links.map((l) => {
    const a = pos.get(l.from)!, b = pos.get(l.to)!;
    const h = l.amount * scale;
    const y0 = a.y + (outY.get(l.from) ?? 0), y1 = b.y + (inY.get(l.to) ?? 0);
    outY.set(l.from, (outY.get(l.from) ?? 0) + h); inY.set(l.to, (inY.get(l.to) ?? 0) + h);
    const x0 = a.x + nodeW, x1 = b.x, cx = (x0 + x1) / 2;
    const d = `M${x0},${y0} C${cx},${y0} ${cx},${y1} ${x1},${y1} L${x1},${y1 + h} C${cx},${y1 + h} ${cx},${y0 + h} ${x0},${y0 + h} Z`;
    const endNode = flows.nodes.find((n) => n.id === (l.from === "income" ? l.to : l.from))!;
    return { ...l, d, color: COLOR[endNode.kind], key: `${l.from}>${l.to}`, endId: endNode.id };
  });
  // labels beside the outer columns: keep them from piling up on the small nodes by pushing each one below the last
  const labelY = new Map<string, number>();
  const minGap = phone ? 12 : 16;
  for (const ci of [0, 2]) {
    let last = -Infinity;
    for (const n of cols[ci]!) { const p = pos.get(n.id)!; let y = phone ? p.y + Math.min(p.h / 2, 6) + 3 : p.y + p.h / 2 + 4; if (y < last + minGap) y = last + minGap; labelY.set(n.id, y); last = y; }
    const over = last + 4 - H; if (over > 0) for (const n of cols[ci]!) labelY.set(n.id, labelY.get(n.id)! - over);
  }
  const halo = phone ? { paintOrder: "stroke" as const, stroke: "var(--card)", strokeWidth: 3, strokeLinejoin: "round" as const } : {};
  const dim = (id: string) => hot !== null && hot !== id;
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto", fontFamily: "inherit" }} onMouseLeave={() => setHot(null)}>
        {bands.map((b) => <path key={b.key} d={b.d} fill={b.color} opacity={dim(b.endId) ? 0.12 : 0.38} onMouseEnter={() => setHot(b.endId)} onClick={() => setHot(hot === b.endId ? null : b.endId)}><title>{`${formatMoney(b.amount)} · ${pct(b.amount)}`}</title></path>)}
        {flows.nodes.map((n) => { const p = pos.get(n.id)!; const l = p.col === 0, r = p.col === 2; const text = `${n.name}`; const amt = `${whole(n.amount)}${p.col !== 1 ? ` · ${pct(n.amount)}` : ""}`;
          return (
            <g key={n.id} opacity={dim(n.id) && n.id !== "income" ? 0.35 : 1} onMouseEnter={() => n.id !== "income" && setHot(n.id)} onClick={() => n.id !== "income" && setHot(hot === n.id ? null : n.id)} style={{ cursor: n.id === "income" ? "default" : "pointer" }}>
              <rect x={p.x} y={p.y} width={nodeW} height={p.h} rx={2} fill={COLOR[n.kind]} />
              {phone ? (
                p.col === 1 ? (
                  <text x={p.x + nodeW / 2} y={p.y - 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text)" style={halo}>{text} {whole(n.amount)}</text>
                ) : (
                  <text x={l ? p.x + nodeW + 4 : p.x - 4} y={labelY.get(n.id)} textAnchor={l ? "start" : "end"} fontSize="9.5" fill="var(--text)" fontWeight="600" style={halo}>{text}<tspan fontWeight="400"> {whole(n.amount)}</tspan></text>
                )
              ) : (
                p.col === 1 ? (
                  <text x={p.x + nodeW / 2} y={p.y - 6} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--text)">{text} · {whole(n.amount)}</text>
                ) : (
                  <text x={l ? p.x - 8 : p.x + nodeW + 8} y={labelY.get(n.id)} textAnchor={l ? "end" : "start"} fontSize="12" fill="var(--text)" fontWeight="600">{text.length > 26 ? text.slice(0, 25) + "…" : text}<tspan fill="var(--muted)" fontWeight="400"> {amt}</tspan></text>
                )
              )}
            </g>
          ); })}
      </svg>
      <div className="text-[11px]" style={{ color: "var(--muted)" }}>Income by payee on the left; on the right, spending by budget group, retirement & 529 contributions, and what was left over{flows.shortfall > 0 ? " — this month outflows beat income, so the difference came from earlier months" : ""}. Tap a band to follow it.</div>
    </div>
  );
}

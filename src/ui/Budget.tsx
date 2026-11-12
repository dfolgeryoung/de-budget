import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, parseMoney } from "../budget/money";
import { addMonths } from "../budget/dates";
import type { MonthPayload } from "../server/month";
import type { CategoryMonth } from "../budget/engine";
import { Chevron } from "./icons";
import { api } from "./api";
import { useToast } from "./Toast";
import { CategoryPanel } from "./CategoryPanel";
import { Sheet } from "./Sheet";
import { MonthPanel } from "./MonthPanel";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

const chipStyle: Record<string, { bg: string; fg: string }> = {
  funded: { bg: "var(--green-bg)", fg: "var(--green-text)" },
  none: { bg: "var(--green-bg)", fg: "var(--green-text)" },
  covered: { bg: "var(--green-bg)", fg: "var(--green-text)" },
  underfunded: { bg: "var(--yellow-bg)", fg: "var(--yellow-text)" },
  not_enough: { bg: "var(--yellow-bg)", fg: "var(--yellow-text)" },
  overspent: { bg: "var(--red-bg)", fg: "var(--red-text)" },
};
const AUTO: [string, string][] = [
  ["underfunded", "Underfunded"], ["assigned_last_month", "Assigned last month"], ["spent_last_month", "Spent last month"],
  ["average_assigned", "Average assigned"], ["average_spent", "Average spent"], ["reduce_overfunding", "Reduce overfunding"],
  ["reset_available", "Reset available amounts"], ["reset_assigned", "Reset assigned amounts"],
];

export function statusText(c: CategoryMonth): { text: string; color: string } {
  const goal = c.goal;
  if (c.status === "overspent") return { text: `Overspent by ${formatMoney(-c.available)}`, color: "var(--red-text)" };
  if (c.status === "underfunded" || c.status === "not_enough") return { text: `Underfunded by ${formatMoney(c.short)}`, color: "var(--muted)" };
  if (goal && c.activity < 0) return { text: c.available === 0 ? "Fully spent" : `Spent ${formatMoney(-c.activity)} of ${formatMoney(goal.amount)}`, color: "var(--muted)" };
  if (goal) return { text: "Funded", color: "var(--muted)" };
  return { text: "", color: "var(--muted)" };
}

export function Bar({ c }: { c: CategoryMonth }) {
  const goal = c.goal;
  const base = goal && goal.amount > 0 ? goal.amount : Math.max(1, c.available + Math.max(0, -c.activity));
  const spent = Math.min(1, Math.max(0, -c.activity) / base);
  const funded = Math.min(1, Math.max(0, (c.available + Math.max(0, -c.activity)) / base));
  const color = c.status === "overspent" ? "var(--red)" : c.status === "underfunded" || c.status === "not_enough" ? "var(--yellow)" : "var(--green)";
  return (
    <div className="h-1.5 rounded-full overflow-hidden flex w-full" style={{ background: "var(--track)" }}>
      <div className="h-full stripes" style={{ width: `${spent * 100}%` }} />
      <div className="h-full" style={{ width: `${Math.max(0, funded - spent) * 100}%`, background: color }} />
    </div>
  );
}

export function Budget({ me, showBarsDefault, refreshKey, onChanged }: { me: { id: string; initial?: string }; showBarsDefault: boolean; refreshKey: number; onChanged: () => void }) {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<MonthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | "rta" | null>(null);
  const [bars, setBars] = useState(showBarsDefault);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [recent, setRecent] = useState<{ id: string; at: string; fromCategoryId: string | null; toCategoryId: string | null; amount: number; how: string; undone: boolean }[] | null>(null);
  const undoStack = useRef<string[][]>([]);
  const redoStack = useRef<{ month: string; from: string | null; to: string | null; amount: number }[][]>([]);
  const toast = useToast();
  const isPhone = typeof matchMedia !== "undefined" && !matchMedia("(min-width: 768px)").matches;

  const load = () => {
    setError(null);
    fetch(month ? `/api/month/${month}` : "/api/month")
      .then(async (r) => (r.ok ? setData((await r.json()) as MonthPayload) : setError((await r.json()).error ?? r.statusText)))
      .catch((e) => setError(String(e)));
  };
  useEffect(load, [month, refreshKey]);
  const byId = useMemo(() => new Map(data?.view.categories.map((c) => [c.categoryId, c]) ?? []), [data]);
  const catName = (id: string | null) => (id ? `${data?.categories[id]?.emoji ?? ""} ${data?.categories[id]?.name ?? ""}`.trim() : "Ready to Assign");

  async function afterMoves(ids: (string | null)[], text: string, replay?: { from: string | null; to: string | null; amount: number }[]) {
    const real = ids.filter((x): x is string => !!x);
    if (real.length) { undoStack.current.push(real); redoStack.current = []; }
    load(); onChanged();
    toast(text, real.length ? async () => { await api("/move/undo", { method: "POST", json: { moveIds: real } }); undoStack.current = undoStack.current.filter((x) => x !== real); if (replay) redoStack.current.push(replay.map((r) => ({ ...r, month: data!.month }))); load(); onChanged(); } : undefined);
  }
  async function undo() {
    const ids = undoStack.current.pop();
    if (!ids) return toast("Nothing to undo");
    const rows = recent ?? (await api<typeof recent>(`/moves/${data!.month}`));
    const replay = ids.map((id) => rows?.find((r) => r.id === id)).filter(Boolean).map((r) => ({ month: data!.month, from: r!.fromCategoryId, to: r!.toCategoryId, amount: r!.amount }));
    await api("/move/undo", { method: "POST", json: { moveIds: ids } });
    redoStack.current.push(replay);
    load(); onChanged(); toast("Undid the last move");
  }
  async function redo() {
    const moves = redoStack.current.pop();
    if (!moves) return toast("Nothing to redo");
    const ids: string[] = [];
    for (const m of moves) { const r = await api<{ moveId: string | null }>("/move", { method: "POST", json: m }); if (r.moveId) ids.push(r.moveId); }
    undoStack.current.push(ids); load(); onChanged(); toast("Redid the move");
  }
  async function commitAssigned(id: string, text: string) {
    setEditing(null);
    const amount = parseMoney(text);
    const c = byId.get(id);
    if (amount === null || !c || amount === c.assigned) return;
    const r = await api<{ moveId: string | null }>("/assign", { method: "POST", json: { month: data!.month, categoryId: id, amount } });
    afterMoves([r.moveId], `${catName(id)}: assigned ${formatMoney(amount)}`, [{ from: amount > c.assigned ? null : id, to: amount > c.assigned ? id : null, amount: Math.abs(amount - c.assigned) }]);
  }
  async function runAuto(option: string) {
    setAutoOpen(false);
    const only = [...selected];
    const r = await api<{ moveIds: string[] }>("/auto-assign", { method: "POST", json: { month: data!.month, option, only: only.length ? only : undefined } });
    afterMoves(r.moveIds, r.moveIds.length ? `Auto-assign: ${AUTO.find(([k]) => k === option)?.[1]} (${r.moveIds.length} ${r.moveIds.length === 1 ? "category" : "categories"})` : "Nothing to assign");
  }
  async function doMove(from: string | null, to: string | null, amount: number) {
    const r = await api<{ moveId: string | null }>("/move", { method: "POST", json: { month: data!.month, from, to, amount } });
    afterMoves([r.moveId], `Moved ${formatMoney(amount)} from ${catName(from)} to ${catName(to)}`, [{ from, to, amount }]);
  }

  if (error) return <p className="text-sm" style={{ color: "var(--red-text)" }}>{error}</p>;
  if (!data) return <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!data.groups.length)
    return (
      <div className="rounded-xl p-6 text-sm" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        Nothing here yet — import the spreadsheet export under <a href="#settings" style={{ color: "var(--accent-text)", fontWeight: 600 }}>Settings</a>.
      </div>
    );

  const { view } = data;
  const rta = view.readyToAssign;
  const rtaColor = rta === 0 ? { bg: "var(--green-solid)", fg: "#fff", glow: "0 0 0 3px rgba(47,191,98,0.18), 0 4px 14px rgba(47,191,98,0.35)" } : rta > 0 ? { bg: "var(--yellow-bg)", fg: "var(--yellow-text)", glow: "none" } : { bg: "var(--red-bg)", fg: "var(--red-text)", glow: "none" };
  const visibleIds = data.groups.flatMap((g) => g.categories).filter((id) => !data.categories[id]?.hidden);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const tb = "inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold";
  const panel = open ? (
    <CategoryPanel
      key={open}
      month={data.month}
      categoryId={open === "rta" ? null : open}
      data={data}
      onClose={() => setOpen(null)}
      onMove={doMove}
      onAssign={(id, amount) => commitAssigned(id, String(amount / 100))}
      onOpenOther={(id) => setOpen(id)}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button aria-label="Previous month" onClick={() => setMonth(addMonths(data.month, -1))} className="w-9 h-9 rounded-full inline-flex items-center justify-center" style={{ border: "1px solid var(--field)", background: "var(--card)", color: "var(--muted)" }}><Chevron dir="left" /></button>
          <h1 className="text-xl font-bold">{monthLabel(data.month)}</h1>
          <button aria-label="Next month" onClick={() => setMonth(addMonths(data.month, 1))} className="w-9 h-9 rounded-full inline-flex items-center justify-center" style={{ border: "1px solid var(--field)", background: "var(--card)", color: "var(--muted)" }}><Chevron dir="right" /></button>
        </div>
        <div className="flex items-center gap-3 relative">
          <button onClick={() => setOpen("rta")} className="flex items-center gap-3 rounded-xl px-4 py-2" style={{ background: rtaColor.bg, color: rtaColor.fg, boxShadow: rtaColor.glow }} title="Move money from Ready to Assign">
            <span className="text-xs font-semibold uppercase tracking-wider">Ready to Assign</span>
            <span className="text-2xl font-bold">{formatMoney(rta)}</span>
          </button>
          <button onClick={() => setAutoOpen((o) => !o)} className="hidden md:inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>Auto-assign <Chevron size={12} /></button>
          {autoOpen && (
            <div className="absolute right-0 top-12 z-20 rounded-xl shadow-lg flex flex-col py-1 w-64" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>{selected.size ? `${selected.size} selected` : "Whole plan"}</div>
              {AUTO.map(([k, l]) => <button key={k} onClick={() => runAuto(k)} className="text-left px-3 py-2 text-sm hover:opacity-80">{l}</button>)}
            </div>
          )}
        </div>
      </div>

      {data.check && (
        <div className="rounded-xl p-3 text-sm" style={{ background: data.check.ok ? "var(--green-bg)" : "var(--red-bg)", color: data.check.ok ? "var(--green-text)" : "var(--red-text)" }}>
          {data.check.ok ? <>✓ Matches the spreadsheet to the cent — Ready to Assign, every category, every account (export imported {data.check.source?.slice(0, 16).replace("T", " ")}).</> : (
            <><div className="font-semibold">Differs from the spreadsheet (expected while testing entries here):</div><ul className="list-disc ml-5">{data.check.diffs.slice(0, 8).map((d) => <li key={d}>{d}</li>)}{data.check.diffs.length > 8 && <li>… and {data.check.diffs.length - 8} more</li>}</ul></>
          )}
        </div>
      )}

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-2 px-3 py-2 flex-wrap" style={{ background: "var(--card-alt)", borderBottom: "1px solid var(--border)" }}>
            <div className="flex items-center gap-1" style={{ color: "var(--accent-text)" }}>
              <button className={tb} onClick={() => toast("Adding categories arrives with Settings in phase 4")}>+ Category</button>
              <button className={tb} onClick={undo}>Undo</button>
              <button className={tb} onClick={redo}>Redo</button>
              <button className={tb} onClick={async () => setRecent(recent ? null : await api(`/moves/${data.month}`))}>Recent moves</button>
            </div>
            <div className="flex rounded-md p-0.5" style={{ background: "var(--group)" }} role="group" aria-label="Row density">
              <button aria-label="Show progress bars" title="Show progress bars" aria-pressed={bars} onClick={() => setBars(true)} className="w-9 h-7 rounded inline-flex items-center justify-center" style={bars ? { background: "var(--card)", color: "var(--accent-text)", boxShadow: "0 1px 2px rgba(0,0,0,0.12)" } : { color: "var(--muted)" }}>
                {/* two rows, each with a progress bar beneath */}
                <svg aria-hidden="true" width="18" height="16" viewBox="0 0 18 16" fill="currentColor"><rect x="1" y="1" width="9" height="2" rx="1" /><rect x="1" y="5" width="16" height="2.5" rx="1.25" opacity="0.45" /><rect x="1" y="5" width="10" height="2.5" rx="1.25" /><rect x="1" y="10" width="7" height="2" rx="1" /><rect x="1" y="14" width="16" height="2.5" rx="1.25" opacity="0.45" /><rect x="1" y="14" width="5" height="2.5" rx="1.25" /></svg>
              </button>
              <button aria-label="Hide progress bars" title="Hide progress bars (compact rows)" aria-pressed={!bars} onClick={() => setBars(false)} className="w-9 h-7 rounded inline-flex items-center justify-center" style={!bars ? { background: "var(--card)", color: "var(--accent-text)", boxShadow: "0 1px 2px rgba(0,0,0,0.12)" } : { color: "var(--muted)" }}>
                {/* four plain rows */}
                <svg aria-hidden="true" width="18" height="16" viewBox="0 0 18 16" fill="currentColor"><rect x="1" y="1" width="9" height="2" rx="1" /><rect x="1" y="5" width="12" height="2" rx="1" /><rect x="1" y="9" width="7" height="2" rx="1" /><rect x="1" y="13" width="10" height="2" rx="1" /></svg>
              </button>
            </div>
          </div>
          {recent && (
            <div className="px-4 py-2 text-xs flex flex-col gap-1" style={{ background: "var(--card-alt)", borderBottom: "1px solid var(--border)", color: "var(--text-2)" }}>
              {recent.length === 0 && <span>No moves this month yet.</span>}
              {recent.slice(0, 12).map((m) => <span key={m.id} style={{ textDecoration: m.undone ? "line-through" : undefined }}>{m.at.slice(5, 16).replace("T", " ")} · {formatMoney(m.amount)} {catName(m.fromCategoryId)} → {catName(m.toCategoryId)} <em style={{ color: "var(--muted)" }}>({m.how})</em></span>)}
            </div>
          )}
          <div className="grid items-center text-[11px] font-semibold uppercase tracking-wider px-4 py-2" style={{ gridTemplateColumns: "36px minmax(0,1fr) 110px 110px 130px", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
            <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(visibleIds) : new Set())} className="m-0" />
            <span>Category</span><span className="text-right hidden md:block">Assigned</span><span className="text-right hidden md:block">Activity</span><span className="text-right">Available</span>
          </div>
          {data.groups.map((g) => {
            const rows = g.categories.map((id) => byId.get(id)).filter((c): c is CategoryMonth => !!c && !data.categories[c.categoryId]?.hidden);
            const tot = (k: "assigned" | "activity" | "available") => rows.reduce((s, c) => s + c[k], 0);
            const isOpen = !collapsed.has(g.id);
            const gSel = rows.length > 0 && rows.every((r) => selected.has(r.categoryId));
            return (
              <div key={g.id}>
                <div className="grid items-center text-[13px] font-semibold px-4 py-2" style={{ gridTemplateColumns: "36px minmax(0,1fr) 110px 110px 130px", background: "var(--group)", color: "var(--text-2)", borderTop: "1px solid var(--border)" }}>
                  <input type="checkbox" aria-label={`Select ${g.name}`} checked={gSel} onChange={(e) => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (e.target.checked ? n.add(r.categoryId) : n.delete(r.categoryId))); return n; })} className="m-0" />
                  <button onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })} className="text-left inline-flex items-center gap-1.5"><Chevron dir={isOpen ? "down" : "right"} size={12} /> {g.name}</button>
                  <span className="text-right hidden md:block">{formatMoney(tot("assigned"))}</span>
                  <span className="text-right hidden md:block">{formatMoney(tot("activity"))}</span>
                  <span className="text-right">{formatMoney(tot("available"))}</span>
                </div>
                {isOpen && rows.map((c) => {
                  const meta = data.categories[c.categoryId]!;
                  const chip = chipStyle[c.status] ?? chipStyle.none!;
                  const st = statusText(c);
                  const isSel = open === c.categoryId;
                  return (
                    <div key={c.categoryId} className={"grid items-center px-4 py-2 text-sm" + (isSel ? "" : " row-hover")} style={{ gridTemplateColumns: "36px minmax(0,1fr) 110px 110px 130px", borderTop: "1px solid var(--border-soft)", background: isSel ? "var(--selected)" : c.status === "underfunded" ? "var(--yellow-row)" : undefined, boxShadow: isSel ? "inset 3px 0 0 var(--navy)" : undefined }}>
                      <input type="checkbox" aria-label={`Select ${meta.name}`} checked={selected.has(c.categoryId)} onChange={(e) => setSelected((s) => { const n = new Set(s); e.target.checked ? n.add(c.categoryId) : n.delete(c.categoryId); return n; })} className="m-0" />
                      <button onClick={() => setOpen(c.categoryId)} className="min-w-0 text-left flex flex-col pr-3">
                        <div className="flex items-baseline gap-2 whitespace-nowrap min-w-0">
                          <span className="font-medium shrink-0" style={{ fontWeight: isSel ? 600 : 500 }}>{meta.emoji ? `${meta.emoji} ` : ""}{meta.name}</span>
                          <span className="text-xs overflow-hidden text-ellipsis" style={{ color: st.color }}>{st.text}</span>
                        </div>
                        {/* the bar slides open/closed when progress bars are toggled */}
                        {(c.goal || c.activity !== 0 || c.available !== 0) && (
                          <div className="grid w-full transition-[grid-template-rows,opacity] duration-200 ease-out" style={{ gridTemplateRows: bars ? "1fr" : "0fr", opacity: bars ? 1 : 0 }}>
                            <div className="overflow-hidden"><div className="pt-1.5"><Bar c={c} /></div></div>
                          </div>
                        )}
                      </button>
                      <span className="text-right hidden md:block">
                        {editing?.id === c.categoryId ? (
                          <input autoFocus value={editing.text} onChange={(e) => setEditing({ id: c.categoryId, text: e.target.value })} onBlur={() => commitAssigned(c.categoryId, editing.text)} onKeyDown={(e) => { if (e.key === "Enter") commitAssigned(c.categoryId, editing.text); if (e.key === "Escape") setEditing(null); }} className="w-24 text-right rounded px-1.5 py-0.5 outline-none" style={{ border: "1px solid var(--navy)", background: "var(--card)" }} />
                        ) : (
                          <button onClick={() => setEditing({ id: c.categoryId, text: (c.assigned / 100).toFixed(2) })} className="rounded px-1.5 py-0.5 hover:opacity-70" title="Click to change" disabled={meta.kind === "card_payment"}>{formatMoney(c.assigned)}</button>
                        )}
                      </span>
                      <span className="text-right hidden md:block" style={{ color: "var(--muted)" }}>{formatMoney(c.activity)}</span>
                      <span className="text-right">
                        <button onClick={() => setOpen(c.categoryId)} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold" style={{ background: chip.bg, color: chip.fg }}>
                          {c.status === "funded" && <span className="inline-flex w-4 h-4 rounded-full items-center justify-center text-white text-[10px]" style={{ background: "var(--green)" }}>✓</span>}
                          {(c.status === "underfunded" || c.status === "not_enough") && <span className="inline-block w-4 h-4 rounded-full" style={{ border: "2px solid var(--yellow)", background: "linear-gradient(90deg, var(--yellow) 50%, transparent 50%)" }} />}
                          {formatMoney(c.available)}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {!isPhone && <aside className="w-[340px] shrink-0 sticky top-4">{panel ?? <MonthPanel data={data} onPick={(id) => setOpen(id)} />}</aside>}
      </div>
      {panel && isPhone && <Sheet onClose={() => setOpen(null)}>{panel}</Sheet>}

      <div className="grid gap-3 md:grid-cols-3 text-sm">
        <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Cash on budget</div>
          <div className="text-xl font-bold">{formatMoney(view.cashOnBudget)}</div>
          <div style={{ color: "var(--muted)" }}>Days of buffer: {Number.isFinite(data.daysOfBuffer) ? data.daysOfBuffer : "∞"}</div>
        </div>
        <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Cards</div>
          <div>Owed {formatMoney(view.owedOnCards)} · Set aside {formatMoney(view.setAsideForCards)}</div>
          <div style={{ color: view.uncoveredCardDebt > 0 ? "var(--red-text)" : "var(--muted)" }}>Uncovered {formatMoney(view.uncoveredCardDebt)}</div>
        </div>
        <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Zero check</div>
          <div className="text-xl font-bold" style={{ color: view.zeroCheck === 0 ? "var(--green-text)" : "var(--red-text)" }}>{view.zeroCheck === 0 ? "✓ $0.00" : formatMoney(view.zeroCheck)}</div>
          <div style={{ color: "var(--muted)" }}>cash − (available + ready to assign)</div>
        </div>
      </div>
    </div>
  );
}

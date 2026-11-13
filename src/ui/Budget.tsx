import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, parseMoney } from "../budget/money";
import { addMonths } from "../budget/dates";
import type { MonthPayload } from "../server/month";
import type { CategoryMonth } from "../budget/engine";
import { Chevron } from "./icons";
import { Marquee } from "./Marquee";
import { api } from "./api";
import { useToast } from "./Toast";
import { CategoryPanel } from "./CategoryPanel";
import { Sheet } from "./Sheet";
import { MonthPanel } from "./MonthPanel";
import { AddCategory } from "./AddCategory";

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
    <div className="rounded-full overflow-hidden flex w-full" style={{ height: 5, background: "var(--track)" }}>
      <div className="h-full stripes" style={{ width: `${spent * 100}%` }} />
      <div className="h-full" style={{ width: `${Math.max(0, funded - spent) * 100}%`, background: color }} />
    </div>
  );
}

export function Budget({ me, showBarsDefault, refreshKey, onChanged }: { me: { id: string; initial?: string; avatarEmoji?: string }; showBarsDefault: boolean; refreshKey: number; onChanged: () => void }) {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<MonthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | "rta" | "summary" | null>(null);
  const [bars, setBars] = useState(showBarsDefault);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const autoRef = useRef<HTMLDivElement>(null);
  // the auto-assign menu closes on a click anywhere else, or Escape
  useEffect(() => {
    if (!autoOpen) return;
    const down = (e: PointerEvent) => { if (!autoRef.current?.contains(e.target as Node)) setAutoOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setAutoOpen(false); };
    document.addEventListener("pointerdown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [autoOpen]);
  // drag-to-reorder (desktop): the id being dragged and where it would land
  const [dragId, setDragIdState] = useState<string | null>(null);
  const [dropAt, setDropAtState] = useState<{ groupId: string; index: number } | null>(null);
  const dragRef = useRef<{ id: string | null; at: { groupId: string; index: number } | null }>({ id: null, at: null }); // drop can arrive before React re-renders
  const setDragId = (id: string | null) => { dragRef.current.id = id; setDragIdState(id); };
  const setDropAt = (at: { groupId: string; index: number } | null) => { dragRef.current.at = at; setDropAtState(at); };
  const dragArmed = useRef(false); // only a drag started on the grip handle may move a row
  // phone: press-and-hold lifts a row; the finger moves it; the native touchmove listener below (non-passive) stops the page scrolling meanwhile
  const [touchDrag, setTouchDrag] = useState<{ id: string; dy: number } | null>(null);
  const touchRef = useRef<{ id: string | null; timer: number | null; startX: number; startY: number; lastY: number; moved: boolean }>({ id: null, timer: null, startX: 0, startY: 0, lastY: 0, moved: false });
  // Home's budget check hands over a category to jump to: open its panel, uncollapse its group and scroll its row into view
  useEffect(() => {
    if (!data) return;
    let handed: string | null = null;
    try { handed = sessionStorage.getItem("budget-select"); if (handed) sessionStorage.removeItem("budget-select"); } catch { /* private mode */ }
    if (!handed || !data.categories[handed]) return;
    const id = handed;
    setCollapsed((s) => { const n = new Set(s); for (const g of data.groups) if (g.categories.includes(id)) n.delete(g.id); return n; });
    setOpen(id);
    setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-cat="${id}"]`);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (row) { row.style.transition = "background 1200ms"; row.style.background = "var(--selected)"; setTimeout(() => { row.style.background = ""; }, 1600); }
    }, 60);
  }, [data]);
  useEffect(() => {
    // on the document (the list mounts after loading); it only intervenes while a row is lifted
    const onMove = (e: TouchEvent) => {
      const t = touchRef.current, touch = e.touches[0]; if (!touch) return;
      if (!t.id) { if (Math.hypot(touch.clientX - t.startX, touch.clientY - t.startY) > 8) { t.moved = true; if (t.timer) { clearTimeout(t.timer); t.timer = null; } } return; }
      e.preventDefault();
      t.lastY = touch.clientY;
      setTouchDrag({ id: t.id, dy: touch.clientY - t.startY });
      // where would it land: the row or group header under the finger
      const under = document.elementsFromPoint(touch.clientX, touch.clientY).find((x) => ((x as HTMLElement).dataset?.cat && (x as HTMLElement).dataset.cat !== t.id) || (x as HTMLElement).dataset?.grouphead) as HTMLElement | undefined;
      if (under?.dataset.cat) {
        const r = under.getBoundingClientRect();
        setDropAt({ groupId: under.dataset.group!, index: Number(under.dataset.index) + (touch.clientY > r.top + r.height / 2 ? 1 : 0) });
      } else if (under?.dataset.grouphead) setDropAt({ groupId: under.dataset.grouphead, index: 0 });
      // auto-scroll near the edges
      const vh = window.innerHeight;
      if (touch.clientY < 110) window.scrollBy(0, -10); else if (touch.clientY > vh - 130) window.scrollBy(0, 10);
    };
    document.addEventListener("touchmove", onMove, { passive: false });
    return () => document.removeEventListener("touchmove", onMove);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const touchStart = (id: string) => (e: React.TouchEvent) => {
    const t = touchRef.current, touch = e.touches[0]!;
    t.startX = touch.clientX; t.startY = touch.clientY; t.lastY = touch.clientY; t.moved = false; t.id = null;
    if (t.timer) clearTimeout(t.timer);
    t.timer = window.setTimeout(() => { if (t.moved) return; t.id = id; t.moved = true; setDragId(id); setTouchDrag({ id, dy: 0 }); if (navigator.vibrate) navigator.vibrate(15); }, 450);
  };
  const touchEnd = () => {
    const t = touchRef.current;
    if (t.timer) { clearTimeout(t.timer); t.timer = null; }
    if (t.id) { t.id = null; setTouchDrag(null); dropCategory(); }
  };
  const [addOpen, setAddOpen] = useState(false);
  async function release(categoryId: string, amount: number) {
    try { await api("/move", { method: "POST", json: { month: data!.month, from: categoryId, to: null, amount, how: "release" } }); toast(`Released ${formatMoney(amount)} into Ready to Assign`); load(); onChanged(); }
    catch (e) { toast(`Couldn't release: ${(e as Error).message}`); }
  }
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
  async function dropCategory() {
    const dragId = dragRef.current.id, dropAt = dragRef.current.at;
    if (!data || !dragId || !dropAt) { setDragId(null); setDropAt(null); return; }
    const from = data.groups.find((g) => g.categories.includes(dragId))!;
    const groups = data.groups.map((g) => ({ ...g, categories: g.categories.filter((id) => id !== dragId) }));
    const target = groups.find((g) => g.id === dropAt.groupId)!;
    let index = dropAt.index;
    if (from.id === target.id && index > from.categories.indexOf(dragId)) index -= 1; // removing it shifted the slots
    target.categories.splice(Math.max(0, Math.min(index, target.categories.length)), 0, dragId);
    const changed = groups.filter((g) => g.id === from.id || g.id === target.id);
    setData({ ...data, groups });
    setDragId(null); setDropAt(null);
    try { await api("/categories/reorder", { method: "PUT", json: { groups: changed.map((g) => ({ groupId: g.id, ids: g.categories })) } }); }
    catch (e) { toast(`Couldn't save the order: ${(e as Error).message}`); load(); }
  }
  const rowDragProps = (groupId: string, index: number) => ({
    onDragOver: (e: React.DragEvent) => { if (!dragRef.current.id) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDropAt({ groupId, index: index + (e.clientY > r.top + r.height / 2 ? 1 : 0) }); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); dropCategory(); },
  });
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
  const tb = "tb-btn inline-flex items-center gap-1.5 rounded-md px-2.5 h-7 text-[13px] font-semibold leading-none";
  const ic = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const panel = open && open !== "summary" ? (
    <CategoryPanel
      key={open}
      month={data.month}
      categoryId={open === "rta" ? null : open}
      data={data}
      onClose={() => setOpen(null)}
      onMove={doMove}
      onAssign={(id, amount) => commitAssigned(id, String(amount / 100))}
      onOpenOther={(id) => setOpen(id)}
      onChanged={() => { load(); onChanged(); }}
    />
  ) : null;

  const statusIcon = (c: CategoryMonth) =>
    c.status === "funded" ? <span aria-label="Funded" className="inline-flex w-4 h-4 rounded-full items-center justify-center text-white shrink-0" style={{ background: "var(--green)" }}><svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12.5 10 17.5 19 7" /></svg></span>
    : c.status === "underfunded" || c.status === "not_enough" ? <span aria-label="Partly funded" className="inline-block w-4 h-4 rounded-full shrink-0" style={{ border: "2px solid var(--yellow)", background: "linear-gradient(90deg, var(--yellow) 50%, transparent 50%)" }} />
    : c.goal && c.status !== "overspent" ? <span aria-label="Partly funded" className="inline-block w-4 h-4 rounded-full shrink-0" style={{ border: "2px solid var(--green)", background: "linear-gradient(90deg, var(--green) 50%, transparent 50%)" }} />
    : null;

  if (isPhone) {
    const [summaryOpen, setSummaryOpen] = [open === "summary", (v: boolean) => setOpen(v ? "summary" : null)];
    const pill = rta === 0 ? { text: "All money assigned", bg: "var(--green-solid)", fg: "#fff" } : rta > 0 ? { text: `${formatMoney(rta)} to assign`, bg: "var(--yellow-bg)", fg: "var(--yellow-text)" } : { text: `Over by ${formatMoney(-rta)}`, bg: "var(--red-bg)", fg: "var(--red-text)" };
    return (
      <div className="flex flex-col -mx-4" style={{ gap: 10 }}>
        <div className="relative px-5 pb-4 flex flex-col" style={{ background: "var(--rail)", color: "#fff", paddingTop: "calc(1rem + env(safe-area-inset-top))", gap: 14 }}>
          <div className="flex items-center justify-between">
            <button aria-label="Previous month" onClick={() => setMonth(addMonths(data.month, -1))} className="w-11 h-11 rounded-full inline-flex items-center justify-center" style={{ background: "rgba(255,255,255,0.12)" }}><Chevron dir="left" size={16} /></button>
            <div className="text-lg font-semibold tracking-wide">{monthLabel(data.month)}</div>
            <button aria-label="Next month" onClick={() => setMonth(addMonths(data.month, 1))} className="w-11 h-11 rounded-full inline-flex items-center justify-center" style={{ background: "rgba(255,255,255,0.12)" }}><Chevron dir="right" size={16} /></button>
          </div>
          <div className="flex items-end justify-between">
            <button onClick={() => setOpen("rta")} className="flex flex-col text-left" style={{ gap: 2 }}>
              <span className="text-xs font-medium uppercase opacity-80" style={{ letterSpacing: "0.08em" }}>Ready to Assign</span>
              <span className="font-bold" style={{ fontSize: "calc(34px * var(--fs))", lineHeight: 1.1 }}>{formatMoney(rta)}</span>
            </button>
            <button onClick={() => setOpen("rta")} className="text-xs font-semibold rounded-full" style={{ background: pill.bg, color: pill.fg, padding: "6px 10px" }}>{pill.text}</button>
          </div>
          <button onClick={() => setSummaryOpen(!summaryOpen)} className="flex items-center justify-between rounded-[10px] text-[13px]" style={{ background: "rgba(255,255,255,0.10)", padding: "10px 12px" }}>
            <span className="flex items-center gap-2.5">
              <span>Cash <strong>{formatMoney(view.cashOnBudget).replace(/\.\d\d$/, "")}</strong></span><span className="opacity-50">·</span>
              <span>Cards <strong>{formatMoney(view.owedOnCards).replace(/\.\d\d$/, "")}</strong></span><span className="opacity-50">·</span>
              <span>Buffer <strong>{Number.isFinite(data.daysOfBuffer) ? `${data.daysOfBuffer} days` : "∞"}</strong></span>
            </span>
            <span aria-hidden="true" className="flex items-center justify-center w-[22px] h-[22px] rounded-full shrink-0" style={{ background: "rgba(255,255,255,0.16)" }}><Chevron size={12} /></span>
          </button>
        </div>

        {/* toolbar: the desktop's actions as icon pills */}
        <div className="no-bar flex items-center gap-2 px-3 overflow-x-auto">
          {[
            { label: "Category", title: "Add a category", on: () => setAddOpen(true), icon: <svg {...ic}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> },
            { label: "Undo", title: "Undo the last move", on: undo, icon: <svg {...ic}><polyline points="9 14 4 9 9 4" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg> },
            { label: "Redo", title: "Redo", on: redo, icon: <svg {...ic}><polyline points="15 14 20 9 15 4" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg> },
            { label: "Moves", title: "Recent moves", on: async () => setRecent(recent ? null : await api(`/moves/${data.month}`)), active: !!recent, icon: <svg {...ic}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg> },
            { label: bars ? "Bars" : "Bars", title: bars ? "Hide progress bars" : "Show progress bars", on: () => setBars((b) => !b), active: bars, icon: <svg {...ic}><rect x="3" y="6" width="18" height="4" rx="2" /><rect x="3" y="14" width="11" height="4" rx="2" /></svg> },
          ].map((b) => (
            <button key={b.label} title={b.title} aria-pressed={b.active} onClick={b.on} className={"pill" + (b.active ? " on" : "")} style={{ padding: "0 12px", gap: 6, background: b.active ? "var(--navy)" : "var(--card)", color: b.active ? "var(--navy-text)" : "var(--text-2)", border: `1px solid ${b.active ? "var(--navy)" : "var(--field)"}` }}>{b.icon}<span className="tb">{b.label}</span></button>
          ))}
        </div>
        {recent && (
          <div className="mx-3 rounded-xl px-3 py-2 text-xs flex flex-col gap-1" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text-2)" }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Recent moves</div>
            {recent.length === 0 && <span>No moves this month yet.</span>}
            {recent.slice(0, 12).map((m) => <span key={m.id} style={{ textDecoration: m.undone ? "line-through" : undefined }}>{m.at.slice(5, 16).replace("T", " ")} · {formatMoney(m.amount)} {catName(m.fromCategoryId)} → {catName(m.toCategoryId)} <em style={{ color: "var(--muted)" }}>({m.how})</em></span>)}
          </div>
        )}
        {addOpen && <Sheet onClose={() => setAddOpen(false)}><AddCategory data={data} onDone={() => { setAddOpen(false); load(); onChanged(); }} /></Sheet>}
        {data.check && !data.check.ok && (
          <div className="mx-3 rounded-xl p-3 text-xs" style={{ background: "var(--red-bg)", color: "var(--red-text)" }}>Differs from the spreadsheet in {data.check.diffs.length} place{data.check.diffs.length === 1 ? "" : "s"} (expected while testing entries here).</div>
        )}

        <div className="px-3 flex flex-col" style={{ gap: 10 }}>
          {data.groups.map((g) => {
            const rows = g.categories.map((id) => byId.get(id)).filter((c): c is CategoryMonth => !!c && !data.categories[c.categoryId]?.hidden);
            const isOpen = !collapsed.has(g.id);
            const total = rows.reduce((s, c) => s + c.available, 0);
            return (
              <div key={g.id} className="rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <button data-grouphead={g.id} onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })} className="w-full flex items-center justify-between text-[13px] font-semibold" style={{ padding: "10px 14px", background: "var(--group)", color: "var(--text-2)", boxShadow: touchDrag && dropAt?.groupId === g.id && dropAt.index === 0 ? "inset 0 -2px 0 var(--navy)" : undefined }}>
                  <span className="flex items-center gap-2 min-w-0 whitespace-nowrap"><Chevron dir={isOpen ? "down" : "right"} size={11} /><span className="truncate">{g.name}</span></span>
                  <span className="shrink-0 pl-3">{formatMoney(total)}</span>
                </button>
                {isOpen && rows.map((c, ri) => {
                  const meta = data.categories[c.categoryId]!;
                  const chip = chipStyle[c.status] ?? chipStyle.none!;
                  const st = statusText(c);
                  const icon = statusIcon(c);
                  const lifted = touchDrag?.id === c.categoryId;
                  const lineAbove = touchDrag && dropAt?.groupId === g.id && dropAt.index === ri;
                  const lineBelow = touchDrag && dropAt?.groupId === g.id && dropAt.index === ri + 1 && ri === rows.length - 1;
                  return (
                    <button key={c.categoryId} data-cat={c.categoryId} data-group={g.id} data-index={ri} onClick={() => { if (!touchRef.current.moved) setOpen(c.categoryId); }}
                      onTouchStart={touchStart(c.categoryId)} onTouchEnd={touchEnd} onTouchCancel={touchEnd} onContextMenu={(e) => e.preventDefault()}
                      className="w-full flex items-center gap-3 text-left" style={{ padding: "11px 14px", borderTop: lineAbove ? "2px solid var(--navy)" : "1px solid var(--border-soft)", borderBottom: lineBelow ? "2px solid var(--navy)" : undefined, background: lifted ? "var(--card)" : c.status === "underfunded" ? "var(--yellow-row)" : undefined,
                        transform: lifted ? `translateY(${touchDrag!.dy}px) scale(1.02)` : undefined, boxShadow: lifted ? "0 8px 24px rgba(0,0,0,0.22)" : undefined, position: lifted ? "relative" : undefined, zIndex: lifted ? 20 : undefined, opacity: lifted ? 0.95 : 1, transition: lifted ? "none" : "transform 150ms", WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}>
                      <span className="text-lg w-6 text-center shrink-0">{meta.emoji ?? "·"}</span>
                      <span className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                        <span className="flex justify-between items-center gap-2">
                          <span className="flex items-baseline gap-2 whitespace-nowrap min-w-0 text-[15px]"><span className="font-medium shrink-0">{meta.name}</span><span className="text-[11px] overflow-hidden text-ellipsis" style={{ color: st.color }}>{st.text}</span></span>
                          <span className="inline-flex items-center gap-1.5 rounded-full text-[13px] font-semibold shrink-0" style={{ background: chip.bg, color: chip.fg, padding: icon ? "3px 10px 3px 4px" : "4px 10px" }}>{icon}{formatMoney(c.available)}</span>
                        </span>
                        {bars && (c.goal || c.activity !== 0 || c.available !== 0) && <Bar c={c} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        {summaryOpen && <Sheet onClose={() => setOpen(null)}><MonthPanel data={data} onPick={(id) => setOpen(id)} onRelease={release} /></Sheet>}
        {panel && <Sheet onClose={() => setOpen(null)}>{panel}</Sheet>}
      </div>
    );
  }

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
          <div ref={autoRef} className="contents">
          <button onClick={() => setAutoOpen((o) => !o)} className="hidden md:inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>Auto-assign <Chevron size={12} /></button>
          {autoOpen && (
            <div className="absolute right-0 top-12 z-20 rounded-xl shadow-lg flex flex-col py-1 w-64" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>{selected.size ? `${selected.size} selected` : "Whole plan"}</div>
              {AUTO.map(([k, l]) => <button key={k} onClick={() => runAuto(k)} className="text-left px-3 py-2 text-sm hover:opacity-80">{l}</button>)}
            </div>
          )}
          </div>
        </div>
      </div>

      {data.check && (
        <div className="rounded-xl p-3 text-sm" style={{ background: data.check.ok ? "var(--green-bg)" : "var(--red-bg)", color: data.check.ok ? "var(--green-text)" : "var(--red-text)" }}>
          {data.check.ok ? <>✓ Matches the spreadsheet to the cent — Ready to Assign, every category, every account ({data.check.source?.replace(/T(\d\d:\d\d).*/, " $1")}).</> : (
            <><div className="font-semibold">Differs from the spreadsheet (expected while testing entries here):</div><ul className="list-disc ml-5">{data.check.diffs.slice(0, 8).map((d) => <li key={d}>{d}</li>)}{data.check.diffs.length > 8 && <li>… and {data.check.diffs.length - 8} more</li>}</ul></>
          )}
        </div>
      )}

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-2 px-3 py-2 flex-wrap" style={{ background: "var(--card-alt)", borderBottom: "1px solid var(--border)" }}>
            <div className="flex items-center gap-1" style={{ color: "var(--accent-text)" }}>
              <button className={tb} onClick={() => setAddOpen(true)}><svg {...ic}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>Category</button>
              <button className={tb} onClick={undo} title="Undo the last move"><svg {...ic}><polyline points="9 14 4 9 9 4" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>Undo</button>
              <button className={tb} onClick={redo} title="Redo"><svg {...ic}><polyline points="15 14 20 9 15 4" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>Redo</button>
              <button className={tb + (recent ? " on" : "")} onClick={async () => setRecent(recent ? null : await api(`/moves/${data.month}`))}><svg {...ic}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>Recent moves</button>
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
          <div className="grid items-center text-[11px] font-semibold uppercase tracking-wider px-4 py-2" style={{ gridTemplateColumns: "36px minmax(0,1fr) 90px 90px 130px", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
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
                <div className="grid items-center text-[13px] font-semibold px-4 py-2" style={{ gridTemplateColumns: "36px minmax(0,1fr) 90px 90px 130px", background: "var(--group)", color: "var(--text-2)", borderTop: "1px solid var(--border)", boxShadow: dragId && dropAt?.groupId === g.id && dropAt.index === 0 && (isOpen ? false : true) ? "inset 0 -2px 0 var(--navy)" : undefined }}
                  onDragOver={(e) => { if (!dragRef.current.id) return; e.preventDefault(); setDropAt({ groupId: g.id, index: 0 }); }} onDrop={(e) => { e.preventDefault(); dropCategory(); }}>
                  <input type="checkbox" aria-label={`Select ${g.name}`} checked={gSel} onChange={(e) => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (e.target.checked ? n.add(r.categoryId) : n.delete(r.categoryId))); return n; })} className="m-0" />
                  <button onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })} className="text-left inline-flex items-center gap-1.5"><Chevron dir={isOpen ? "down" : "right"} size={12} /> {g.name}</button>
                  <span className="text-right hidden md:block">{formatMoney(tot("assigned"))}</span>
                  <span className="text-right hidden md:block">{formatMoney(tot("activity"))}</span>
                  <span className="text-right">{formatMoney(tot("available"))}</span>
                </div>
                {isOpen && rows.map((c, ri) => {
                  const meta = data.categories[c.categoryId]!;
                  const chip = chipStyle[c.status] ?? chipStyle.none!;
                  const st = statusText(c);
                  const isSel = open === c.categoryId;
                  const lineAbove = dragId && dropAt?.groupId === g.id && dropAt.index === ri;
                  const lineBelow = dragId && dropAt?.groupId === g.id && dropAt.index === ri + 1 && ri === rows.length - 1;
                  return (
                    <div key={c.categoryId} data-cat={c.categoryId} className={"drag-row grid items-center px-4 py-2 text-sm" + (isSel ? "" : " row-hover")}
                      draggable onDragStart={(e) => { if (!dragArmed.current) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.categoryId); setDragId(c.categoryId); }}
                      onDragEnd={() => { dragArmed.current = false; setDragId(null); setDropAt(null); }} {...rowDragProps(g.id, ri)}
                      style={{ gridTemplateColumns: "36px minmax(0,1fr) 90px 90px 130px", borderTop: lineAbove ? "2px solid var(--navy)" : "1px solid var(--border-soft)", borderBottom: lineBelow ? "2px solid var(--navy)" : undefined, background: isSel ? "var(--selected)" : c.status === "underfunded" ? "var(--yellow-row)" : undefined, boxShadow: isSel ? "inset 3px 0 0 var(--navy)" : undefined, opacity: dragId === c.categoryId ? 0.4 : 1 }}>
                      <span className="flex items-center gap-1">
                        <input type="checkbox" aria-label={`Select ${meta.name}`} checked={selected.has(c.categoryId)} onChange={(e) => setSelected((s) => { const n = new Set(s); e.target.checked ? n.add(c.categoryId) : n.delete(c.categoryId); return n; })} className="m-0" />
                        <span aria-label="Drag to reorder" title="Drag to reorder" className="grip inline-flex w-3.5 h-5 items-center justify-center shrink-0 -mr-2" style={{ color: "var(--faint)", cursor: "grab" }} onMouseDown={() => { dragArmed.current = true; }} onMouseUp={() => { dragArmed.current = false; }}>
                          <svg aria-hidden="true" width="8" height="14" viewBox="0 0 8 14" fill="currentColor"><circle cx="2" cy="2" r="1.3" /><circle cx="6" cy="2" r="1.3" /><circle cx="2" cy="7" r="1.3" /><circle cx="6" cy="7" r="1.3" /><circle cx="2" cy="12" r="1.3" /><circle cx="6" cy="12" r="1.3" /></svg>
                        </span>
                      </span>
                      <button onClick={() => setOpen(c.categoryId)} className="min-w-0 text-left flex flex-col pr-2">
                        <div className="flex items-baseline gap-2 whitespace-nowrap min-w-0">
                          <span className="font-medium shrink-0" style={{ fontWeight: isSel ? 600 : 500 }}>{meta.emoji ? `${meta.emoji} ` : ""}{meta.name}</span>
                          <Marquee className="text-xs" style={{ color: st.color }}>{st.text}</Marquee>
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

        {!isPhone && <aside className="w-[340px] shrink-0 sticky top-4">{panel ?? <MonthPanel data={data} onPick={(id) => setOpen(id)} onRelease={release} />}</aside>}
        {addOpen && <Sheet onClose={() => setAddOpen(false)}><AddCategory data={data} onDone={() => { setAddOpen(false); load(); onChanged(); }} /></Sheet>}
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

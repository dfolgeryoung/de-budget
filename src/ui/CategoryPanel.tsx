import { useEffect, useState, type ReactNode } from "react";
import { formatMoney, parseMoney } from "../budget/money";
import type { MonthPayload } from "../server/month";
import type { LedgerRow } from "../server/transactions";
import { api } from "./api";
import { Bar, statusText } from "./Budget";
import { Chevron } from "./icons";
import { Select } from "./Select";

type Tab = "summary" | "goal" | "transactions" | "history";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function CategoryPanel({ month, categoryId, data, onClose, onMove, onAssign, onOpenOther }: {
  month: string; categoryId: string | null; data: MonthPayload; onClose: () => void;
  onMove: (from: string | null, to: string | null, amount: number) => Promise<void>;
  onAssign: (id: string, amount: number) => void;
  onOpenOther: (id: string) => void;
}) {
  const c = categoryId ? data.view.categories.find((x) => x.categoryId === categoryId) ?? null : null;
  const meta = categoryId ? data.categories[categoryId] : null;
  const [tab, setTab] = useState<Tab>("summary");
  const [txns, setTxns] = useState<LedgerRow[] | null>(null);
  const [hist, setHist] = useState<{ months: { month: string; assigned: number; activity: number; available: number }[]; averageAssigned: number; averageSpent: number } | null>(null);
  const rtaMode = categoryId === null;
  const [other, setOther] = useState<string | "rta">(rtaMode ? "" : "rta");
  const [dir, setDir] = useState<"to" | "from">(rtaMode ? "to" : "to");
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const cats = data.groups.flatMap((g) => g.categories.filter((id) => !data.categories[id]?.hidden && data.categories[id]?.kind !== "card_payment").map((id) => ({ id, name: `${data.categories[id]?.emoji ?? ""} ${data.categories[id]?.name}`.trim(), available: data.view.categories.find((x) => x.categoryId === id)?.available ?? 0 })));

  useEffect(() => {
    if (!categoryId) return;
    if (tab === "transactions" && !txns) api<LedgerRow[]>(`/transactions?category=${categoryId}&month=${month}`).then(setTxns).catch(() => setTxns([]));
    if (tab === "history" && !hist) api<typeof hist>(`/category/${categoryId}/history/${month}`).then(setHist).catch(() => setHist(null));
  }, [tab, categoryId, month, txns, hist]);

  const suggested = c ? (c.short > 0 ? c.short : c.available < 0 ? -c.available : 0) : Math.max(0, data.view.readyToAssign);
  useEffect(() => { if (suggested > 0 && !amt) setAmt((suggested / 100).toFixed(2)); }, [suggested, amt]);

  async function go() {
    const cents = parseMoney(amt);
    if (!cents || cents <= 0) return;
    setBusy(true);
    try {
      if (rtaMode) await onMove(null, other === "rta" ? null : other, cents);
      else if (dir === "to") await onMove(other === "rta" ? null : other, categoryId, cents);
      else await onMove(categoryId, other === "rta" ? null : other, cents);
      setAmt("");
    } finally { setBusy(false); }
  }

  const row = (l: string, v: string, strong = false, color?: string) => (
    <div className="flex justify-between text-[13px]" style={strong ? { fontWeight: 700 } : undefined}><span style={{ color: strong ? undefined : "var(--muted)" }}>{l}</span><span style={{ color }}>{v}</span></div>
  );
  const tabBtn = (t: Tab, l: string) => (
    <button key={t} onClick={() => setTab(t)} className="px-2.5 py-2 text-[13px]" style={tab === t ? { color: "var(--accent-text)", fontWeight: 600, borderBottom: "2px solid var(--navy)" } : { color: "var(--muted)", fontWeight: 500 }}>{l}</button>
  );

  const boxHead = (title: string, right?: ReactNode) => (
    <div className="flex items-center justify-between px-4 py-2" style={{ background: "var(--group)", borderBottom: "1px solid var(--border)" }}>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-2)" }}>{title}</h2>
      {right}
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
    <div className="rounded-xl flex flex-col overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      {boxHead(rtaMode ? "Ready to Assign" : "Category", (
        <button onClick={onClose} className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: "var(--accent-text)" }}><Chevron dir="left" size={11} /> Month summary</button>
      ))}
      <div className="px-4 pt-3 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="text-[17px] font-bold">{rtaMode ? "Ready to Assign" : `${meta?.emoji ?? ""} ${meta?.name}`}</div>
        </div>
        {c && (
          <>
            <div className="flex items-baseline justify-between gap-2 text-xs" style={{ color: statusText(c).color }}>
              <span>{statusText(c).text}</span>
              <span className="font-bold text-base" style={{ color: c.available < 0 ? "var(--red-text)" : "var(--green-text)" }}>{formatMoney(c.available)}</span>
            </div>
            <Bar c={c} />
            <div className="flex gap-0.5" style={{ borderBottom: "1px solid var(--border)" }}>{tabBtn("summary", "Summary")}{tabBtn("goal", "Goal")}{tabBtn("transactions", "Transactions")}{tabBtn("history", "History")}</div>
          </>
        )}
        {rtaMode && <div className="text-2xl font-bold" style={{ color: data.view.readyToAssign === 0 ? "var(--green-text)" : data.view.readyToAssign > 0 ? "var(--yellow-text)" : "var(--red-text)" }}>{formatMoney(data.view.readyToAssign)}</div>}
      </div>

      <div className="px-4 py-3 flex flex-col gap-2">
        {c && tab === "summary" && (
          <>
            {row("Left over from last month", formatMoney(c.carriedIn))}
            <div className="flex justify-between items-center text-[13px]"><span style={{ color: "var(--muted)" }}>Assigned this month</span>
              <button onClick={() => { const v = prompt("Assigned this month", (c.assigned / 100).toFixed(2)); const n = v === null ? null : parseMoney(v); if (n !== null) onAssign(c.categoryId, n); }} className="inline-flex items-center gap-1.5" title="Change">{formatMoney(c.assigned)} <span style={{ color: "var(--muted)" }}>✎</span></button></div>
            {row("Activity", formatMoney(c.activity))}
            <div style={{ borderTop: "1px solid var(--border-soft)" }} className="pt-2">{row("Available", formatMoney(c.available), true, c.available < 0 ? "var(--red-text)" : "var(--green-text)")}</div>
            {c.goal && (
              <div className="rounded-lg p-3 mt-1 flex flex-col gap-1.5 text-[13px]" style={{ background: "var(--bg)" }}>
                <div className="flex justify-between items-center"><span className="font-semibold">{c.goal.type === "refill_to" ? "Refill up to" : "Set aside another"} {formatMoney(c.goal.amount)}{c.goal.targetDate ? ` by ${c.goal.targetDate}` : c.goal.frequencyMonths && c.goal.frequencyMonths > 1 ? ` every ${c.goal.frequencyMonths} months` : " monthly"}</span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={c.status === "funded" ? { background: "var(--green-bg)", color: "var(--green-text)" } : c.status === "overspent" ? { background: "var(--red-bg)", color: "var(--red-text)" } : { background: "var(--yellow-bg)", color: "var(--yellow-text)" }}>{c.status === "funded" ? "Funded" : c.status === "overspent" ? "Overspent" : c.status === "not_enough" ? "Not enough money" : "Underfunded"}</span></div>
                <div className="flex justify-between" style={{ color: "var(--muted)" }}><span>{c.short > 0 ? `${formatMoney(c.short)} short this month` : "On track"}</span><span>Needed {formatMoney(c.needed)}</span></div>
              </div>
            )}
          </>
        )}
        {c && tab === "goal" && (
          <div className="text-[13px] flex flex-col gap-2">
            {c.goal ? (
              <>
                {row("Type", c.goal.type === "refill_to" ? "Refill up to" : "Set aside another")}
                {row("Amount", formatMoney(c.goal.amount))}
                {row("Frequency", c.goal.targetDate ? `by ${c.goal.targetDate}` : `every ${c.goal.frequencyMonths ?? 1} month${(c.goal.frequencyMonths ?? 1) > 1 ? "s" : ""}`)}
                {row("Needed this month", formatMoney(c.needed))}
                {row("Progress", `${Math.round(c.progress * 100)}%`)}
                <p style={{ color: "var(--muted)" }}>Editing goals arrives in phase 4; until then they come from the sheet.</p>
              </>
            ) : <p style={{ color: "var(--muted)" }}>No goal on this category.</p>}
          </div>
        )}
        {c && tab === "transactions" && (
          <div className="text-[13px] flex flex-col gap-1.5">
            {txns === null && <span style={{ color: "var(--muted)" }}>Loading…</span>}
            {txns?.length === 0 && <span style={{ color: "var(--muted)" }}>Nothing this month.</span>}
            {txns?.map((r) => (
              <div key={r.id} className="flex justify-between gap-2"><span className="truncate">{MON[Number(r.date.slice(5, 7)) - 1]} {Number(r.date.slice(8, 10))} · {r.payee ?? "—"}</span><span style={{ color: (r.lines.find((l) => l.categoryId === categoryId)?.amount ?? 0) < 0 ? "var(--neg)" : "var(--green-text)" }}>{r.amount === null ? "—" : formatMoney(r.lines.find((l) => l.categoryId === categoryId)?.amount ?? r.amount)}</span></div>
            ))}
            <a href="#transactions" className="font-semibold" style={{ color: "var(--accent-text)" }}>All transactions ›</a>
          </div>
        )}
        {c && tab === "history" && (
          <div className="text-[13px] flex flex-col gap-1.5">
            {!hist && <span style={{ color: "var(--muted)" }}>Loading…</span>}
            {hist && (
              <>
                {row("Average assigned (12 mo)", formatMoney(hist.averageAssigned))}
                {row("Average spent (12 mo)", formatMoney(hist.averageSpent))}
                {hist.months.slice(0, 6).map((m) => <div key={m.month} className="flex justify-between" style={{ color: "var(--text-2)" }}><span>{MON[Number(m.month.slice(5, 7)) - 1]} {m.month.slice(0, 4)}</span><span>assigned {formatMoney(m.assigned)} · spent {formatMoney(-m.activity)}</span></div>)}
                {hist.months.length === 0 && <span style={{ color: "var(--muted)" }}>No earlier months yet.</span>}
              </>
            )}
          </div>
        )}
        {rtaMode && <p className="text-[13px]" style={{ color: "var(--muted)" }}>Move money straight from Ready to Assign into a category. Negative means more is assigned than you have.</p>}
      </div>

    </div>

    <div className="rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      {boxHead("Move money")}
      <div className="px-4 py-3 flex flex-col gap-2">
        <div className="flex gap-2 items-center">
          {!rtaMode && (
            <Select ariaLabel="Direction" value={dir} onChange={(v) => setDir((v as "to" | "from") ?? "to")} options={[{ value: "to", label: "To" }, { value: "from", label: "From" }]} style={{ width: 84, height: 36, borderRadius: 8 }} />
          )}
          <Select ariaLabel={rtaMode ? "Category" : "Other category"} value={other} onChange={(v) => setOther(v ?? "")} placeholder="Pick a category…" className="flex-1" style={{ height: 36, borderRadius: 8 }} menuWidth={300}
            options={[...(rtaMode ? [] : [{ value: "rta", label: "Ready to Assign", hint: formatMoney(data.view.readyToAssign) }]), ...cats.filter((x) => x.id !== categoryId).map((x) => ({ value: x.id, label: x.name, hint: formatMoney(x.available) }))]} />
        </div>
        <div className="flex gap-2 items-center">
          <span className="flex items-center rounded-lg px-2.5" style={{ border: "1px solid var(--field)", background: "var(--card)", width: 120 }}><span className="text-[13px]" style={{ color: "var(--muted)" }}>$</span><input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" className="w-full py-2 text-[13px] bg-transparent outline-none" placeholder="0.00" /></span>
          <button onClick={go} disabled={busy || !other} className="flex-1 min-w-0 rounded-lg py-2 text-[13px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis disabled:opacity-60" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>
            {rtaMode ? "Assign" : dir === "to" ? `Move to ${meta?.name}` : `Move out of ${meta?.name}`}
          </button>
        </div>
        {!rtaMode && cats.length > 0 && <button onClick={() => { const next = cats[(cats.findIndex((x) => x.id === categoryId) + 1) % cats.length]; if (next) onOpenOther(next.id); }} className="text-xs text-left" style={{ color: "var(--accent-text)" }}>Next category ›</button>}
      </div>
    </div>
    </div>
  );
}

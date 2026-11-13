import { useEffect, useState } from "react";
import { api } from "./api";
import { formatMoney, parseMoney } from "../budget/money";
import { Select } from "./Select";
import { useToast } from "./Toast";
import type { CategoryMonth } from "../budget/engine";
import { monthLabel } from "./Budget";

interface GoalRow { validFrom: string; type: "refill_to" | "set_aside"; amount: number; frequencyMonths: number | null; targetDate: string | null }
const describe = (g: GoalRow) => g.amount === 0 ? "No goal" : `${g.type === "refill_to" ? "Refill up to" : "Set aside another"} ${formatMoney(g.amount)} ${g.targetDate ? `by ${g.targetDate}` : (g.frequencyMonths ?? 1) === 1 ? "every month" : `every ${g.frequencyMonths} months`}`;

/** Edit a category's goal for the month being viewed onward; earlier months keep theirs. */
export function GoalEditor({ categoryId, month, current, onChanged }: { categoryId: string; month: string; current: CategoryMonth; onChanged: () => void }) {
  const g = current.goal;
  const [type, setType] = useState<"refill_to" | "set_aside">(g?.type ?? "refill_to");
  const [amount, setAmount] = useState(g ? (g.amount / 100).toFixed(2) : "");
  const [mode, setMode] = useState<"every" | "by">(g?.targetDate ? "by" : "every");
  const [every, setEvery] = useState(String(g?.frequencyMonths ?? 1));
  const [by, setBy] = useState(g?.targetDate ?? "");
  const [history, setHistory] = useState<GoalRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const loadHistory = () => api<GoalRow[]>(`/category/${categoryId}/goals`).then((r) => setHistory(Array.isArray(r) ? r : [])).catch(() => setHistory([]));
  useEffect(() => { loadHistory(); }, [categoryId]); // eslint-disable-line react-hooks/exhaustive-deps
  const field = { height: 36, border: "1px solid var(--field)", background: "var(--card)", color: "var(--text)" } as const;

  async function save(remove = false) {
    const cents = remove ? 0 : parseMoney(amount);
    if (cents === null || (!remove && cents <= 0)) return toast("Enter a goal amount");
    if (!remove && mode === "by" && !/^\d{4}-\d{2}-\d{2}$/.test(by)) return toast("Pick a target date");
    setBusy(true);
    try {
      await api(`/category/${categoryId}/goal`, { method: "PUT", json: { validFrom: month, type, amount: cents, frequencyMonths: mode === "every" ? Math.max(1, Number(every) || 1) : null, targetDate: mode === "by" ? by : null } });
      toast(remove ? `No goal from ${monthLabel(month)} on` : `Goal set from ${monthLabel(month)} on`);
      loadHistory(); onChanged();
    } catch (e) { toast(`Not saved: ${(e as Error).message}`); } finally { setBusy(false); }
  }
  async function forget(validFrom: string) {
    await api(`/category/${categoryId}/goal/${validFrom}`, { method: "DELETE" });
    toast(`Removed the change from ${monthLabel(validFrom)}`); loadHistory(); onChanged();
  }

  return (
    <div className="text-[13px] flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-lg p-3" style={{ background: "var(--card-alt)", border: "1px solid var(--border-soft)" }}>
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>From {monthLabel(month)} on</div>
        <div className="flex gap-2">
          <Select ariaLabel="Goal type" value={type} onChange={(v) => setType((v as "refill_to" | "set_aside") ?? "refill_to")} options={[{ value: "refill_to", label: "Refill up to", hint: "top the balance back up" }, { value: "set_aside", label: "Set aside another", hint: "add this much each time" }]} className="flex-1" style={{ height: 36, borderRadius: 8 }} menuWidth={260} />
          <span className="flex items-center rounded-lg px-2.5 w-32" style={field}><span style={{ color: "var(--muted)" }}>$</span><input aria-label="Goal amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="w-full min-w-0 bg-transparent outline-none text-right" /></span>
        </div>
        <div className="flex items-center gap-2">
          <Select ariaLabel="Schedule" value={mode} onChange={(v) => setMode((v as "every" | "by") ?? "every")} options={[{ value: "every", label: "Every" }, { value: "by", label: "By a date" }]} style={{ height: 36, borderRadius: 8, width: 118 }} />
          {mode === "every" ? (
            <span className="flex items-center gap-1.5"><input aria-label="Months" value={every} onChange={(e) => setEvery(e.target.value)} inputMode="numeric" className="fld w-14 rounded-lg px-2 text-center outline-none" style={field} /><span style={{ color: "var(--muted)" }}>month{Number(every) === 1 ? "" : "s"}</span></span>
          ) : (
            <input aria-label="Target date" type="date" value={by} onChange={(e) => setBy(e.target.value)} className="fld rounded-lg px-2 outline-none" style={field} />
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button onClick={() => save()} disabled={busy} className="rounded-lg px-3 h-9 text-[13px] font-semibold disabled:opacity-60" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>{g ? "Save change" : "Set goal"}</button>
          {g && <button onClick={() => save(true)} disabled={busy} className="rounded-lg px-3 h-9 text-[13px] font-semibold" style={{ color: "var(--red-text)" }}>No goal from this month</button>}
        </div>
        {g && <div style={{ color: "var(--muted)" }}>Now: {describe({ validFrom: g.validFrom, type: g.type, amount: g.amount, frequencyMonths: g.frequencyMonths ?? null, targetDate: g.targetDate ?? null })} · needs {formatMoney(current.needed)} this month</div>}
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>History</div>
        {history === null && <span style={{ color: "var(--muted)" }}>Loading…</span>}
        {history?.length === 0 && <span style={{ color: "var(--muted)" }}>No goal has been set on this category.</span>}
        {history?.map((h) => (
          <div key={h.validFrom} className="flex items-center justify-between gap-2 py-1" style={{ borderTop: "1px solid var(--border-soft)" }}>
            <span><span className="font-semibold">{monthLabel(h.validFrom)}</span> <span style={{ color: "var(--text-2)" }}>· {describe(h)}</span></span>
            <button onClick={() => forget(h.validFrom)} title="Remove this change (the previous goal carries on)" className="text-xs" style={{ color: "var(--muted)" }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

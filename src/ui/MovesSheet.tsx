import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { formatMoney } from "../budget/money";

export interface MoveRow { id: string; at: string; fromCategoryId: string | null; toCategoryId: string | null; amount: number; how: string; undone: boolean; by?: string | null }

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = (iso: string) => { const d = new Date(iso); return { day: `${MON[d.getMonth()]} ${d.getDate()}`, time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }; };

/** How a move happened, as a glyph: by hand, spread across underfunded, auto-assign, typed in the Assigned column, released to next month, reset. */
const HOW: Record<string, { glyph: ReactNode; label: string }> = {
  move: { glyph: "✋", label: "moved by hand" },
  spread: { glyph: "⤭", label: "spread across underfunded" },
  auto_assign: { glyph: "⚡", label: "auto-assign" },
  typed: { glyph: "✎", label: "typed in Assigned" },
  release: { glyph: "⤵", label: "released to next month" },
  reset: { glyph: "↺", label: "reset" },
};

/** The month's money moves as a table — newest first, each with its own Undo. */
export function MovesSheet({ month, monthLabel, catName, onClose, onChanged, phone }: { month: string; monthLabel: string; catName: (id: string | null) => string; onClose: () => void; onChanged: () => void; phone?: boolean }) {
  const [rows, setRows] = useState<MoveRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const load = () => api<MoveRow[]>(`/moves/${month}`).then(setRows).catch((e) => toast((e as Error).message));
  useEffect(() => { load(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  async function undo(m: MoveRow) {
    setBusy(m.id);
    try { await api("/move/undo", { method: "POST", json: { moveIds: [m.id] } }); toast(`Undone: ${formatMoney(m.amount)} ${catName(m.fromCategoryId)} → ${catName(m.toCategoryId)}`); await load(); onChanged(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  }
  const live = rows?.filter((r) => !r.undone).length ?? 0;
  return (
    <Sheet onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="font-bold text-base m-0">Money moves · {monthLabel}</h2><div className="text-xs" style={{ color: "var(--muted)" }}>{rows ? `${live} ${live === 1 ? "move" : "moves"} standing${rows.length - live ? `, ${rows.length - live} undone` : ""}` : "Loading…"}</div></div>
          <button onClick={onClose} className="rounded-lg px-3 h-9 text-[13px] font-semibold" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>Close</button>
        </div>
        {rows && rows.length === 0 && <p className="text-sm m-0" style={{ color: "var(--muted)" }}>No moves this month yet.</p>}
        {rows && rows.length > 0 && phone && (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {rows.map((m, i) => { const w = when(m.at); const h = HOW[m.how] ?? { glyph: "·", label: m.how }; return (
              <div key={m.id} className="px-3 py-2.5 flex flex-col gap-1" style={{ borderTop: i ? "1px solid var(--border-soft)" : undefined, opacity: m.undone ? 0.55 : 1 }}>
                <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--muted)" }}>
                  <span className="font-semibold" style={{ color: "var(--text)" }}>{w.day}</span><span>{w.time}</span>{m.by && <span>· {m.by}</span>}<span className="ml-auto" title={h.label} aria-label={h.label}>{h.glyph}</span>
                  {m.undone ? <span className="text-[11px]">undone</span> : <button onClick={() => undo(m)} disabled={busy !== null} className="rounded-md px-2 h-7 text-[12px] font-semibold disabled:opacity-50" style={{ border: "1px solid var(--field)", background: "var(--card)", color: "var(--text)" }}>Undo</button>}
                </div>
                <div className="grid items-center gap-1.5 text-[13px]" style={{ gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr) auto", textDecoration: m.undone ? "line-through" : undefined }}>
                  <span className="truncate">{catName(m.fromCategoryId)}</span><span style={{ color: "var(--accent-text)" }}>→</span><span className="truncate">{catName(m.toCategoryId)}</span><span className="font-semibold tabular-nums pl-2">{formatMoney(m.amount)}</span>
                </div>
              </div>
            ); })}
            <div className="px-3 py-2 text-[11px] flex flex-wrap gap-x-3 gap-y-1" style={{ color: "var(--muted)", borderTop: "1px solid var(--border-soft)", background: "var(--card-alt)" }}>
              {Object.entries(HOW).map(([k, v]) => <span key={k}><span className="mr-1">{v.glyph}</span>{v.label}</span>)}
            </div>
          </div>
        )}
        {rows && rows.length > 0 && !phone && (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 520 }}>
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider" style={{ color: "var(--muted)", background: "var(--group)" }}>
                    <th className="text-left font-semibold px-3 py-2">When</th>
                    <th className="text-left font-semibold px-2 py-2">From</th>
                    <th className="px-1 py-2" />
                    <th className="text-left font-semibold px-2 py-2">To</th>
                    <th className="text-right font-semibold px-2 py-2">Amount</th>
                    <th className="text-center font-semibold px-2 py-2" title="How">How</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => { const w = when(m.at); const h = HOW[m.how] ?? { glyph: "·", label: m.how }; return (
                    <tr key={m.id} style={{ borderTop: "1px solid var(--border-soft)", opacity: m.undone ? 0.5 : 1, textDecoration: m.undone ? "line-through" : undefined }}>
                      <td className="px-3 py-2 whitespace-nowrap align-middle"><span className="font-semibold">{w.day}</span><span className="ml-1.5" style={{ color: "var(--muted)" }}>{w.time}</span>{m.by && <span className="ml-1.5 text-[11px]" style={{ color: "var(--muted)" }}>{m.by}</span>}</td>
                      <td className="px-2 py-2 align-middle truncate" style={{ maxWidth: 180 }}>{catName(m.fromCategoryId)}</td>
                      <td className="px-1 py-2 align-middle text-center" style={{ color: "var(--accent-text)" }}>→</td>
                      <td className="px-2 py-2 align-middle truncate" style={{ maxWidth: 180 }}>{catName(m.toCategoryId)}</td>
                      <td className="px-2 py-2 align-middle text-right tabular-nums font-semibold whitespace-nowrap">{formatMoney(m.amount)}</td>
                      <td className="px-2 py-2 align-middle text-center" title={h.label} aria-label={h.label}>{h.glyph}</td>
                      <td className="px-2 py-2 align-middle text-right">{m.undone ? <span className="text-[11px]" style={{ color: "var(--muted)", textDecoration: "none" }}>undone</span> : <button onClick={() => undo(m)} disabled={busy !== null} className="rounded-md px-2 h-7 text-[12px] font-semibold disabled:opacity-50" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>Undo</button>}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 text-[11px] flex flex-wrap gap-x-3 gap-y-1" style={{ color: "var(--muted)", borderTop: "1px solid var(--border-soft)", background: "var(--card-alt)" }}>
              {Object.entries(HOW).map(([k, v]) => <span key={k}><span className="mr-1">{v.glyph}</span>{v.label}</span>)}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

import { useEffect, useState } from "react";
import { api } from "./api";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { formatMoney } from "../budget/money";
import type { DupPair } from "../server/duplicates";

/** One pair: both entries with a Delete each, and "keep both". Shared by the Home card and the desktop review sheet. */
export function DupPairRow({ pair, onDone, last }: { pair: DupPair; onDone: (pair: DupPair) => void; last: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function act(what: "keep" | "delete" | "clear", id?: string) {
    setBusy(true);
    try {
      if (what === "keep") { await api("/duplicates/keep", { method: "POST", json: { a: pair.a.id, b: pair.b.id } }); toast("Kept both"); }
      else if (what === "clear") { await api("/duplicates/clear", { method: "POST", json: { keys: [pair.key] } }); toast("Cleared"); }
      else { await api(`/transactions/${id}`, { method: "DELETE" }); toast(`Deleted the ${pair.a.payee} entry`); }
      onDone(pair); dispatchEvent(new Event("lists-changed"));
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="px-3.5 py-2.5 flex flex-col gap-1.5" style={{ borderBottom: last ? undefined : "1px solid var(--border-soft)" }}>
      <div className="flex justify-between items-baseline gap-3"><span className="text-sm font-semibold truncate">{pair.a.payee}</span><span className="text-sm font-semibold tabular-nums shrink-0">{formatMoney(Math.abs(pair.a.amount))}</span></div>
      {[pair.a, pair.b].map((e) => (
        <div key={e.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--group)" }}>
          <span className="flex-1 min-w-0 flex flex-col"><span className="text-[13px] truncate">{e.date.slice(5).replace("-", "/")} · {e.account}{e.category ? ` · ${e.category}` : ""}</span><span className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{e.enteredBy ? `Entered by ${e.enteredBy}` : "From the sheet"}{e.memo ? ` · ${e.memo}` : ""}</span></span>
          <button onClick={() => act("delete", e.id)} disabled={busy} className="text-[12px] font-semibold rounded-md px-2 h-7 shrink-0 disabled:opacity-50" style={{ background: "var(--red-bg)", color: "var(--red-text)" }}>Delete</button>
        </div>
      ))}
      <div className="flex gap-4">
        <button onClick={() => act("keep")} disabled={busy} className="text-[12px] font-semibold disabled:opacity-50" style={{ color: "var(--accent-text)" }}>Keep both — not a duplicate</button>
        <button onClick={() => act("clear")} disabled={busy} title="Already dealt with elsewhere — just take it off the list" className="text-[12px] font-semibold disabled:opacity-50" style={{ color: "var(--muted)" }}>Clear</button>
      </div>
    </div>
  );
}

/** Header action for the cards: dismiss every pair at once. */
export function ClearAllDupes({ onDone, count }: { onDone: () => void; count: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button onClick={async () => { setBusy(true); try { await api("/duplicates/clear", { method: "POST", json: {} }); toast(count === 1 ? "Cleared" : `Cleared ${count}`); onDone(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }} disabled={busy} title="Already dealt with — take them all off the list" className="text-[12px] font-semibold disabled:opacity-50" style={{ color: "var(--accent-text)" }}>Clear all</button>
  );
}

/** Desktop review: every open pair, the one you clicked first. */
export function DupSheet({ focusId, onClose }: { focusId: string | null; onClose: () => void }) {
  const [pairs, setPairs] = useState<DupPair[] | null>(null);
  useEffect(() => { api<{ duplicates: DupPair[] }>("/duplicates").then((r) => setPairs(r.duplicates)).catch(() => setPairs([])); }, []);
  const shown = pairs ? [...pairs].sort((x, y) => Number(y.a.id === focusId || y.b.id === focusId) - Number(x.a.id === focusId || x.b.id === focusId)) : null;
  return (
    <Sheet onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div><h2 className="font-bold text-base m-0">⚠️ Possible duplicates</h2><p className="text-xs m-0" style={{ color: "var(--muted)" }}>Same payee and amount within 3 days. Delete the extra one, or keep both if they're real.</p></div>
        {shown === null ? <p className="text-sm m-0" style={{ color: "var(--muted)" }}>Loading…</p> : shown.length === 0 ? <p className="text-sm m-0" style={{ color: "var(--muted)" }}>Nothing left to review.</p> : (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {shown.map((p, i) => <DupPairRow key={p.key} pair={p} last={i === shown.length - 1} onDone={(d) => setPairs((ps) => (ps ?? []).filter((x) => x.key !== d.key))} />)}
          </div>
        )}
        <div className="flex justify-end"><button onClick={onClose} className="rounded-lg px-4 h-10 text-[14px] font-semibold" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>Close</button></div>
      </div>
    </Sheet>
  );
}

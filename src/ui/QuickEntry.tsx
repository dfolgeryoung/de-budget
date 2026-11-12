import { useEffect, useState } from "react";
import { api, todayISO, type Lists } from "./api";
import { parseMoney, formatMoney } from "../budget/money";
import { parseTypedDate } from "../budget/dates";
import { useToast } from "./Toast";
import { emptyDraft, type EntryDraft } from "./EntryForm";

/** The desktop entry box pinned above the ledger: the common case in one row; "More…" opens the full form. */
export function QuickEntry({ lists, me, account, onSaved, openFull }: { lists: Lists; me: { id: string; initial?: string }; account: string | null; onSaved: () => void; openFull: (d: EntryDraft) => void }) {
  const [d, setD] = useState<EntryDraft>(() => emptyDraft(lists, me, account ?? undefined));
  const [dateText, setDateText] = useState(d.date);
  const [out, setOut] = useState("");
  const [inn, setInn] = useState("");
  const [dup, setDup] = useState<{ date: string; payee: string | null; amount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (account) setD((x) => ({ ...x, accountId: account })); }, [account]);
  const amount = (parseMoney(inn) ?? 0) - (parseMoney(out) ?? 0);
  useEffect(() => {
    if (!d.payee || !amount) { setDup(null); return; }
    const h = setTimeout(() => api<{ duplicate: typeof dup }>(`/transactions/duplicate?payee=${encodeURIComponent(d.payee)}&amount=${amount}&date=${d.date}`).then((r) => setDup(r.duplicate)).catch(() => setDup(null)), 400);
    return () => clearTimeout(h);
  }, [d.payee, amount, d.date]);
  const field = "sel rounded-md px-2 py-1.5 text-[13px] outline-none w-full min-w-0";
  const fs = { border: "1px solid var(--field)", background: "var(--card)", color: "var(--text)" } as const;
  const matches = d.payee.length >= 2 ? lists.payees.filter((p) => p.name.toLowerCase().startsWith(d.payee.toLowerCase())).slice(0, 5) : [];
  function commitDate() { const p = parseTypedDate(dateText, todayISO()); if (p) { setD((x) => ({ ...x, date: p })); setDateText(p); } else setDateText(d.date); }
  async function save() {
    if (!amount) return toast("Enter an outflow or inflow");
    if (!d.categoryId) return toast("Pick a category");
    setBusy(true);
    try {
      await api("/transactions", { method: "POST", json: { date: d.date, accountId: d.accountId, payee: d.payee, memo: d.memo, amount, categoryId: d.categoryId === "rta" ? null : d.categoryId, lines: [], transferToAccountId: null, sharedFiftyFifty: false, hidden: false, trackedAmountId: null, tagIds: [] } });
      toast(`Saved: ${d.payee || "entry"} ${formatMoney(Math.abs(amount))}`);
      if (navigator.vibrate) navigator.vibrate(10);
      setD((x) => ({ ...x, payee: "", memo: "", categoryId: null })); setOut(""); setInn(""); setDup(null);
      onSaved();
      (document.getElementById("qe-payee") as HTMLInputElement | null)?.focus();
    } catch (e) { toast(`Not saved: ${(e as Error).message}`); } finally { setBusy(false); }
  }
  const toFull = () => openFull({ ...d, amountText: Math.abs(amount) ? (Math.abs(amount) / 100).toFixed(2) : "", outflow: amount <= 0 });
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--selected)", border: "1px solid var(--navy)", boxShadow: "0 2px 8px rgba(58,79,125,0.10)" }}>
      <div className="grid items-center px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: "96px minmax(120px,1.4fr) minmax(120px,1.2fr) minmax(80px,1fr) 150px 88px 88px 44px", gap: 10, color: "var(--accent-text)" }}>
        <span>New entry</span><span /><span /><span /><span>Account</span><span className="text-right">Outflow</span><span className="text-right">Inflow</span><span />
      </div>
      <div className="grid items-center px-4 pb-2" style={{ gridTemplateColumns: "96px minmax(120px,1.4fr) minmax(120px,1.2fr) minmax(80px,1fr) 150px 88px 88px 44px", gap: 10 }}>
        <input aria-label="Date" value={dateText} onChange={(e) => setDateText(e.target.value)} onBlur={commitDate} onKeyDown={(e) => e.key === "Enter" && commitDate()} className={field.replace("sel ", "")} style={fs} />
        <div className="relative min-w-0">
          <input id="qe-payee" aria-label="Payee" value={d.payee} onChange={(e) => setD((x) => ({ ...x, payee: e.target.value }))} placeholder="Payee" className={field.replace("sel ", "")} style={fs} list="qe-payees" />
          <datalist id="qe-payees">{lists.payees.map((p) => <option key={p.name} value={p.name} />)}</datalist>
          {matches.length > 0 && matches[0]!.name !== d.payee && matches[0]!.lastCategoryId && !d.categoryId && (
            <button onClick={() => setD((x) => ({ ...x, payee: matches[0]!.name, categoryId: matches[0]!.lastCategoryId }))} className="absolute left-0 top-full mt-1 text-[11px] px-2 py-0.5 rounded z-10" style={{ background: "var(--group)", color: "var(--text-2)" }}>{matches[0]!.name} → remembered category</button>
          )}
        </div>
        <select aria-label="Category" value={d.categoryId ?? ""} onChange={(e) => setD((x) => ({ ...x, categoryId: e.target.value || null }))} className={field} style={fs}>
          <option value="">Category…</option>
          <option value="rta">Ready to Assign (income)</option>
          {lists.groups.filter((g) => !g.system || g.name === "One Month Ahead").map((g) => <optgroup key={g.id} label={g.name}>{g.categories.filter((c) => c.kind !== "card_payment").map((c) => <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ""}{c.name}</option>)}</optgroup>)}
        </select>
        <input aria-label="Memo" value={d.memo} onChange={(e) => setD((x) => ({ ...x, memo: e.target.value }))} placeholder="Memo" className={field.replace("sel ", "")} style={fs} />
        <select aria-label="Account" value={d.accountId} onChange={(e) => setD((x) => ({ ...x, accountId: e.target.value }))} className={field} style={fs}>
          {lists.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input aria-label="Outflow" value={out} onChange={(e) => { setOut(e.target.value); if (e.target.value) setInn(""); }} inputMode="decimal" placeholder="0.00" className={field.replace("sel ", "") + " text-right"} style={fs} onKeyDown={(e) => e.key === "Enter" && save()} />
        <input aria-label="Inflow" value={inn} onChange={(e) => { setInn(e.target.value); if (e.target.value) setOut(""); }} inputMode="decimal" placeholder="0.00" className={field.replace("sel ", "") + " text-right"} style={fs} onKeyDown={(e) => e.key === "Enter" && save()} />
        <button aria-label="Save entry" onClick={save} disabled={busy} className="h-[34px] rounded-md inline-flex items-center justify-center text-white disabled:opacity-60" style={{ background: dup ? "var(--yellow)" : "var(--green-solid)", boxShadow: "0 1px 2px rgba(0,0,0,0.12)" }}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12.5 10 17.5 19 7" /></svg>
        </button>
      </div>
      <div className="flex items-center gap-4 px-4 pb-3 text-xs" style={{ color: "var(--text-2)" }}>
        {dup && <span style={{ color: "var(--yellow-text)" }}>⚠ Possible duplicate: {dup.payee} {formatMoney(Math.abs(dup.amount))} on {dup.date.slice(5).replace("-", "/")}</span>}
        <button onClick={toFull} className="font-semibold" style={{ color: "var(--accent-text)" }}>More… (50/50, hidden, split, transfer, tags, track against)</button>
      </div>
    </div>
  );
}

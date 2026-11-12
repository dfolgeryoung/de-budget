import { useEffect, useMemo, useState } from "react";
import { api, todayISO, type Lists } from "./api";
import { parseMoney, formatMoney } from "../budget/money";
import { parseTypedDate } from "../budget/dates";
import { useToast } from "./Toast";
import type { LedgerRow } from "../server/transactions";

export interface EntryDraft {
  id?: string;
  date: string;
  accountId: string;
  payee: string;
  memo: string;
  amountText: string; // what the person typed, unsigned
  outflow: boolean;
  categoryId: string | null;
  transfer: boolean;
  transferToAccountId: string | null;
  split: { categoryId: string | null; amountText: string }[]; // empty = not split
  sharedFiftyFifty: boolean;
  hidden: boolean;
  trackedAmountId: string | null;
  tagIds: string[];
  more?: boolean; // open the "More" section straight away (set when arriving from a quick-entry chip)
}

export function draftFromRow(r: LedgerRow, lists: Lists): EntryDraft {
  const amt = r.amount ?? 0;
  const multi = r.lines.length > 1;
  return {
    id: r.id, date: r.date, accountId: r.accountId, payee: r.payee ?? "", memo: r.memo ?? "",
    amountText: (Math.abs(amt) / 100).toFixed(2), outflow: amt <= 0,
    categoryId: multi ? null : (r.lines[0]?.categoryId ?? null),
    transfer: !!r.transferToAccountId, transferToAccountId: r.transferToAccountId,
    split: multi ? r.lines.map((l) => ({ categoryId: l.categoryId, amountText: (Math.abs(l.amount) / 100).toFixed(2) })) : [],
    sharedFiftyFifty: r.sharedFiftyFifty, hidden: r.hidden, trackedAmountId: r.trackedAmountId,
    tagIds: r.tagIds.filter((id) => lists.tags.some((t) => t.id === id)),
  };
}

export function emptyDraft(lists: Lists, me: { initial?: string }, accountId?: string): EntryDraft {
  const mine = lists.accounts.find((a) => a.type === "checking" && a.owner === (me.initial ?? "D"));
  return {
    date: todayISO(), accountId: accountId ?? mine?.id ?? lists.accounts[0]?.id ?? "", payee: "", memo: "", amountText: "", outflow: true,
    categoryId: null, transfer: false, transferToAccountId: null, split: [], sharedFiftyFifty: false, hidden: false, trackedAmountId: null, tagIds: [],
  };
}

const field = "w-full rounded-lg px-3 py-2.5 text-[15px] outline-none sel";
const fieldStyle = { border: "1px solid var(--field)", backgroundColor: "var(--card)", color: "var(--text)" } as const;
const chip = (on: boolean) => ({
  border: on ? "2px solid var(--navy)" : "1px solid var(--field)", background: on ? "var(--selected)" : "var(--card)", color: on ? "var(--accent-text)" : "var(--text-2)",
});

export function EntryForm({ lists, me, initial, onSaved, onClose, onDelete }: { lists: Lists; me: { id: string; initial?: string }; initial: EntryDraft; onSaved: (id: string, summary: string) => void; onClose: () => void; onDelete?: (id: string) => void }) {
  const [d, setD] = useState<EntryDraft>(initial);
  // Start with the extra section open when anything in it is already set, or a quick-entry chip asked for it.
  const [moreOpen] = useState(() => !!(initial.more || initial.split.length || initial.transfer || initial.sharedFiftyFifty || initial.hidden || initial.tagIds.length || initial.trackedAmountId || initial.memo));
  const [dup, setDup] = useState<{ date: string; payee: string | null; amount: number } | null>(null);
  const [dateText, setDateText] = useState(initial.date);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const set = (p: Partial<EntryDraft>) => setD((x) => ({ ...x, ...p }));

  const cents = parseMoney(d.amountText) ?? 0;
  const signed = d.outflow ? -Math.abs(cents) : Math.abs(cents);
  const allCats = useMemo(() => lists.groups.flatMap((g) => g.categories.map((c) => ({ ...c, group: g.name, system: g.system }))), [lists]);
  const pickable = allCats.filter((c) => c.kind !== "card_payment");
  const cat = (id: string | null) => allCats.find((c) => c.id === id);
  const payeeMatches = d.payee.length >= 1 ? lists.payees.filter((p) => p.name.toLowerCase().includes(d.payee.toLowerCase())).slice(0, 6) : [];
  const splitTotal = d.split.reduce((s, l) => s + (parseMoney(l.amountText) ?? 0), 0);
  const remainder = Math.abs(cents) - splitTotal;

  // duplicate check as the key fields settle
  useEffect(() => {
    if (!d.payee || !cents) { setDup(null); return; }
    const h = setTimeout(() => {
      api<{ duplicate: typeof dup }>(`/transactions/duplicate?payee=${encodeURIComponent(d.payee)}&amount=${signed}&date=${d.date}${d.id ? `&exclude=${d.id}` : ""}`)
        .then((r) => setDup(r.duplicate)).catch(() => setDup(null));
    }, 400);
    return () => clearTimeout(h);
  }, [d.payee, signed, d.date, d.id, cents]);

  function pickPayee(p: Lists["payees"][number]) {
    set({ payee: p.name, categoryId: d.categoryId ?? p.lastCategoryId, accountId: d.accountId || (p.lastAccountId ?? d.accountId) });
  }
  function commitDate() {
    const parsed = parseTypedDate(dateText, todayISO());
    if (parsed) { set({ date: parsed }); setDateText(parsed); } else setDateText(d.date);
  }

  async function save() {
    setErr(null);
    if (!cents) return setErr("Enter an amount.");
    if (!d.accountId) return setErr("Pick an account.");
    if (d.transfer && !d.transferToAccountId) return setErr("Pick the account to transfer to.");
    if (!d.transfer && !d.split.length && !d.categoryId) return setErr("Pick a category (or Ready to Assign for income).");
    if (d.split.length && remainder !== 0) return setErr(`Split lines add up to ${formatMoney(splitTotal)}; ${formatMoney(remainder)} left to place.`);
    const body = {
      date: d.date, accountId: d.accountId, payee: d.payee, memo: d.memo, amount: signed,
      transferToAccountId: d.transfer ? d.transferToAccountId : null,
      categoryId: d.split.length ? null : d.categoryId === "rta" ? null : d.categoryId,
      lines: d.split.length ? d.split.map((l) => ({ categoryId: l.categoryId === "rta" ? null : l.categoryId, amount: d.outflow ? -Math.abs(parseMoney(l.amountText) ?? 0) : Math.abs(parseMoney(l.amountText) ?? 0) })) : [],
      sharedFiftyFifty: d.sharedFiftyFifty, hidden: d.hidden, trackedAmountId: d.trackedAmountId, tagIds: d.tagIds,
    };
    setBusy(true);
    try {
      const target = d.transfer ? `Transfer to ${lists.accounts.find((a) => a.id === d.transferToAccountId)?.name}` : d.split.length ? "split across categories" : cat(d.categoryId)?.name ?? "Ready to Assign";
      const summary = `${d.id ? "Updated" : "Saved"}: ${d.payee || target} ${formatMoney(Math.abs(cents))} in ${target}`;
      if (d.id) { await api(`/transactions/${d.id}`, { method: "PUT", json: body }); onSaved(d.id, summary); }
      else { const r = await api<{ id: string }>("/transactions", { method: "POST", json: body }); onSaved(r.id, summary); }
      if (navigator.vibrate) navigator.vibrate(10);
    } catch (e) { setErr((e as Error).message); toast(`Not saved: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button onClick={onClose} className="text-[15px]" style={{ color: "var(--muted)" }}>Cancel</button>
        <div className="font-semibold">{d.id ? "Edit entry" : "New entry"}</div>
        <div className="flex rounded-full p-0.5" style={{ background: "var(--group)" }}>
          {(["Outflow", "Inflow"] as const).map((l) => (
            <button key={l} onClick={() => set({ outflow: l === "Outflow", ...(l === "Inflow" && !d.categoryId ? { categoryId: "rta" } : {}) })} className="px-3 py-1.5 rounded-full text-xs font-semibold" style={(d.outflow ? l === "Outflow" : l === "Inflow") ? { background: "var(--navy)", color: "var(--navy-text)" } : { color: "var(--text-2)" }}>{l}</button>
          ))}
        </div>
      </div>

      <label className="flex flex-col items-center gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Amount</span>
        <span className="flex items-center gap-1 leading-none" style={{ color: d.outflow ? "var(--neg)" : "var(--green-text)" }}>
          <span className="text-5xl font-bold">{d.outflow ? "−" : "+"}</span>
          <span className="text-3xl font-semibold mt-1">$</span>
          <input autoFocus inputMode="decimal" value={d.amountText} onChange={(e) => set({ amountText: e.target.value })} placeholder="0.00" className="w-40 text-5xl font-bold bg-transparent outline-none" style={{ color: "inherit" }} />
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>{d.transfer ? "From" : "Account"}</span>
        <div className="no-bar flex gap-2 overflow-x-auto">
          {lists.accounts.map((a) => (
            <button key={a.id} onClick={() => set({ accountId: a.id })} className="px-3.5 py-2 rounded-full text-[13px] font-semibold whitespace-nowrap" style={chip(d.accountId === a.id)}>{a.name}</button>
          ))}
        </div>
      </div>

      {!d.transfer && (
        <label className="flex flex-col gap-1.5 relative">
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Payee</span>
          <input value={d.payee} onChange={(e) => set({ payee: e.target.value })} className={field} style={fieldStyle} placeholder="Trader Joe's" />
          {payeeMatches.length > 0 && d.payee !== payeeMatches[0]?.name && (
            <div className="flex flex-wrap gap-1.5">
              {payeeMatches.map((p) => (
                <button key={p.name} onClick={() => pickPayee(p)} className="text-xs px-2 py-1 rounded-md" style={{ background: "var(--group)", color: "var(--text-2)" }}>
                  {p.name}{p.lastCategoryId ? ` · ${cat(p.lastCategoryId)?.name ?? ""}` : ""}
                </button>
              ))}
            </div>
          )}
        </label>
      )}

      {d.transfer ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>To</span>
          <div className="no-bar flex gap-2 overflow-x-auto">
            {lists.accounts.filter((a) => a.id !== d.accountId).map((a) => (
              <button key={a.id} onClick={() => set({ transferToAccountId: a.id })} className="px-3.5 py-2 rounded-full text-[13px] font-semibold whitespace-nowrap" style={chip(d.transferToAccountId === a.id)}>{a.name}</button>
            ))}
          </div>
        </div>
      ) : d.split.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Split across categories · {remainder === 0 ? "all placed" : `${formatMoney(remainder)} left`}</span>
          {d.split.map((l, i) => (
            <div key={i} className="flex gap-2">
              <select value={l.categoryId ?? ""} onChange={(e) => set({ split: d.split.map((x, j) => (j === i ? { ...x, categoryId: e.target.value || null } : x)) })} className={field} style={fieldStyle}>
                <option value="">Category…</option>
                {pickable.map((c) => <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ""}{c.name}</option>)}
              </select>
              <input inputMode="decimal" value={l.amountText} onChange={(e) => set({ split: d.split.map((x, j) => (j === i ? { ...x, amountText: e.target.value } : x)) })} className={field + " w-28 shrink-0 text-right"} style={fieldStyle} placeholder="0.00" />
            </div>
          ))}
          <div className="flex gap-3 text-xs font-semibold" style={{ color: "var(--accent-text)" }}>
            <button onClick={() => set({ split: [...d.split, { categoryId: null, amountText: remainder > 0 ? (remainder / 100).toFixed(2) : "" }] })}>+ Another line</button>
            <button onClick={() => set({ split: [] })} style={{ color: "var(--muted)" }}>Remove split</button>
          </div>
        </div>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Category</span>
          <select value={d.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value || null })} className={field} style={fieldStyle}>
            <option value="">Pick a category…</option>
            <option value="rta">Ready to Assign (income)</option>
            {lists.groups.filter((g) => !g.system || g.name === "One Month Ahead").map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.categories.filter((c) => c.kind !== "card_payment").map((c) => <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ""}{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium w-14" style={{ color: "var(--muted)" }}>Date</span>
        <button onClick={() => { set({ date: todayISO() }); setDateText(todayISO()); }} className="px-3 py-2 rounded-full text-[13px] font-semibold" style={chip(d.date === todayISO())}>Today</button>
        <button onClick={() => { const y = parseTypedDate("y", todayISO())!; set({ date: y }); setDateText(y); }} className="px-3 py-2 rounded-full text-[13px] font-semibold" style={chip(d.date === parseTypedDate("y", todayISO()))}>Yesterday</button>
        <input value={dateText} onChange={(e) => setDateText(e.target.value)} onBlur={commitDate} onKeyDown={(e) => e.key === "Enter" && commitDate()} className={field + " w-32"} style={fieldStyle} placeholder="11/11 or Nov 11" />
      </div>

      <details className="flex flex-col gap-2" open={moreOpen}>
        <summary className="text-xs font-semibold cursor-pointer" style={{ color: "var(--accent-text)" }}>More: memo, 50/50, hidden, split, transfer, tags, track against</summary>
        <div className="flex flex-col gap-3 pt-3">
          <input value={d.memo} onChange={(e) => set({ memo: e.target.value })} className={field} style={fieldStyle} placeholder="Memo" />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => set({ sharedFiftyFifty: !d.sharedFiftyFifty })} className="px-3 py-1.5 rounded-full text-xs font-semibold" style={chip(d.sharedFiftyFifty)}>Shared 50/50</button>
            <button onClick={() => set({ hidden: !d.hidden })} className="px-3 py-1.5 rounded-full text-xs font-semibold" style={chip(d.hidden)}>Hidden</button>
            <button onClick={() => set({ split: d.split.length ? [] : [{ categoryId: d.categoryId, amountText: "" }, { categoryId: null, amountText: "" }], transfer: false })} className="px-3 py-1.5 rounded-full text-xs font-semibold" style={chip(d.split.length > 0)}>Split across categories</button>
            <button onClick={() => set({ transfer: !d.transfer, split: [] })} className="px-3 py-1.5 rounded-full text-xs font-semibold" style={chip(d.transfer)}>Transfer</button>
          </div>
          {d.sharedFiftyFifty && cents > 0 && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>The other checking will owe {formatMoney(Math.round(cents / 2))} to {lists.accounts.find((a) => a.id === d.accountId)?.name}.</p>
          )}
          {lists.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {lists.tags.map((tg) => (
                <button key={tg.id} onClick={() => set({ tagIds: d.tagIds.includes(tg.id) ? d.tagIds.filter((x) => x !== tg.id) : [...d.tagIds, tg.id] })} className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: tg.color, opacity: d.tagIds.includes(tg.id) ? 1 : 0.5 }}>{tg.name}</button>
              ))}
            </div>
          )}
          {lists.tracked.length > 0 && (
            <select value={d.trackedAmountId ?? ""} onChange={(e) => set({ trackedAmountId: e.target.value || null })} className={field} style={fieldStyle}>
              <option value="">Track against… (none)</option>
              {lists.tracked.map((x) => <option key={x.id} value={x.id}>{x.emoji ? `${x.emoji} ` : ""}{x.name}</option>)}
            </select>
          )}
        </div>
      </details>

      {dup && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-[13px]" style={{ background: "var(--yellow-row)", color: "var(--yellow-text)", border: "1px solid var(--yellow)" }}>
          ⚠ Possible duplicate: {dup.payee} {formatMoney(Math.abs(dup.amount))} on {dup.date.slice(5).replace("-", "/")}
        </div>
      )}
      {err && <div className="text-[13px] rounded-lg px-3 py-2" style={{ background: "var(--red-bg)", color: "var(--red-text)" }}>{err}</div>}

      <button onClick={save} disabled={busy} className="rounded-xl py-3.5 text-[15px] font-semibold disabled:opacity-60" style={{ background: dup ? "var(--yellow)" : "var(--navy)", color: dup ? "#1A1D23" : "var(--navy-text)" }}>
        {busy ? "Saving…" : dup ? "Save anyway" : d.id ? "Save changes" : "Save"}
      </button>
      {d.id && onDelete && <button onClick={() => onDelete(d.id!)} className="py-2 text-[14px] font-semibold" style={{ color: "var(--red-text)" }}>Delete entry</button>}
    </div>
  );
}

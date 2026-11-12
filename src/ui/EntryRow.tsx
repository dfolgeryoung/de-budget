import { useEffect, useMemo, useRef, useState } from "react";
import { api, todayISO, categoryOptions, createTag, type Lists } from "./api";
import { parseMoney, formatMoney } from "../budget/money";
import { parseTypedDate } from "../budget/dates";
import { useToast } from "./Toast";
import { emptyDraft, type EntryDraft } from "./EntryForm";
import { Select, Popover, type SelectOption } from "./Select";
import { ArrowRight, Calendar, Check } from "./icons";

/** Column template shared by the ledger header, ledger rows and the entry rows, so everything lines up. */
export const LEDGER_COLS = "86px minmax(100px,1.2fr) minmax(84px,0.8fr) minmax(110px,1fr) minmax(50px,0.8fr) minmax(70px,0.7fr) 82px 82px 86px 28px";
/** the narrowest the ledger grid goes before the card scrolls sideways instead of clipping */
export const LEDGER_MIN = 860;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pretty = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const fs = { border: "1px solid var(--field)", backgroundColor: "var(--card)", color: "var(--text)", height: 34 } as const;
const field = "fld rounded-md px-2.5 text-[13px] outline-none w-full min-w-0";
const pillCls = "pill select-none";
const pill = (on: boolean, disabled = false) => ({ background: on ? "var(--navy)" : "var(--card)", color: on ? "var(--navy-text)" : "var(--text-2)", border: `1px solid ${on ? "var(--navy)" : "var(--field)"}`, opacity: disabled ? 0.5 : 1 });

/**
 * The desktop entry form, laid out as one ledger row: used pinned above the ledger for new entries and
 * in place of a row when editing it. Split lines slide out beneath; Transfer turns Account/Category into From → To.
 */
export function EntryRow({ lists, me, initial, mode, onSaved, onCancel, onDelete, account }: {
  lists: Lists; me: { id: string; initial?: string }; initial?: EntryDraft; mode: "new" | "edit";
  onSaved: () => void; onCancel?: () => void; onDelete?: () => void; account?: string | null;
}) {
  const [d, setD] = useState<EntryDraft>(() => initial ?? emptyDraft(lists, me, account ?? undefined));
  const [dateText, setDateText] = useState(pretty(d.date));
  const [out, setOut] = useState(initial && initial.outflow && initial.amountText ? initial.amountText : "");
  const [inn, setInn] = useState(initial && !initial.outflow && initial.amountText ? initial.amountText : "");
  const [dup, setDup] = useState<{ date: string; payee: string | null; amount: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payeeOpen, setPayeeOpen] = useState(false);
  const [payeeHi, setPayeeHi] = useState(-1); // -1 = nothing highlighted, Enter saves
  const payeeRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const set = (p: Partial<EntryDraft>) => setD((x) => ({ ...x, ...p }));

  // A new-entry row follows the account filter; the row resets when a different draft is handed in (Duplicate).
  useEffect(() => { if (mode === "new" && account) set({ accountId: account }); }, [account, mode]);
  useEffect(() => {
    if (!initial || mode !== "new") return;
    setD(initial); setDateText(pretty(initial.date));
    setOut(initial.outflow && initial.amountText ? initial.amountText : ""); setInn(!initial.outflow && initial.amountText ? initial.amountText : "");
    if (mode === "new") payeeRef.current?.focus();
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const cents = (parseMoney(inn) ?? 0) || (parseMoney(out) ?? 0);
  const outflow = !inn;
  const signed = outflow ? -Math.abs(cents) : Math.abs(cents);
  const splitTotal = d.split.reduce((s, l) => s + (parseMoney(l.amountText) ?? 0), 0);
  const remainder = Math.abs(cents) - splitTotal;

  const catOptions = useMemo<SelectOption[]>(() => categoryOptions(lists, { income: true }), [lists]);
  const acctOptions = useMemo<SelectOption[]>(() => lists.accounts.map((a) => ({ value: a.id, label: a.name })), [lists]);
  const trackedOptions = useMemo<SelectOption[]>(() => lists.tracked.map((t) => ({ value: t.id, label: `${t.emoji ? t.emoji + " " : ""}${t.name}` })), [lists]);
  const payeeMatches = d.payee.length >= 1 ? lists.payees.filter((p) => p.name.toLowerCase().includes(d.payee.toLowerCase()) && p.name !== d.payee).slice(0, 6) : [];
  const catLabel = (id: string | null) => catOptions.find((o) => o.value === id)?.label ?? "";

  useEffect(() => {
    if (!d.payee || !cents) { setDup(null); return; }
    const h = setTimeout(() => api<{ duplicate: typeof dup }>(`/transactions/duplicate?payee=${encodeURIComponent(d.payee)}&amount=${signed}&date=${d.date}${d.id ? `&exclude=${d.id}` : ""}`).then((r) => setDup(r.duplicate)).catch(() => setDup(null)), 400);
    return () => clearTimeout(h);
  }, [d.payee, signed, d.date, d.id, cents]);
  useEffect(() => { setPayeeHi(-1); }, [d.payee]);

  function commitDate() { const p = parseTypedDate(dateText, todayISO()); if (p) { set({ date: p }); setDateText(pretty(p)); } else setDateText(pretty(d.date)); }
  function pickPayee(p: Lists["payees"][number]) { set({ payee: p.name, categoryId: d.categoryId ?? p.lastCategoryId }); setPayeeOpen(false); }
  function onPayeeKey(e: React.KeyboardEvent) {
    if (!payeeOpen || !payeeMatches.length) { if (e.key === "Enter") save(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setPayeeHi((h) => Math.min(payeeMatches.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setPayeeHi((h) => Math.max(-1, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (payeeHi >= 0) pickPayee(payeeMatches[payeeHi]!); else { setPayeeOpen(false); save(); } }
    else if (e.key === "Escape") setPayeeOpen(false);
  }
  function toggleSplit() {
    if (d.split.length) set({ split: [] });
    else set({ split: [{ categoryId: d.categoryId, amountText: "" }, { categoryId: null, amountText: "" }], transfer: false });
  }
  function toggleTransfer() { set({ transfer: !d.transfer, split: [], transferToAccountId: d.transfer ? null : lists.accounts.find((a) => a.id !== d.accountId)?.id ?? null }); }

  async function save() {
    setErr(null);
    if (!cents) return setErr("Enter an outflow or inflow.");
    if (d.transfer && !d.transferToAccountId) return setErr("Pick the account on the other side of the transfer.");
    if (!d.transfer && !d.split.length && !d.categoryId) return setErr("Pick a category (or Ready to Assign for income).");
    if (d.split.length && remainder !== 0) return setErr(`Split lines add up to ${formatMoney(splitTotal)} — ${formatMoney(Math.abs(remainder))} ${remainder > 0 ? "still to place" : "too much"}.`);
    if (d.split.length && d.split.some((l) => !l.categoryId)) return setErr("Every split line needs a category.");
    const body = {
      date: d.date, accountId: d.accountId, payee: d.payee, memo: d.memo, amount: signed,
      transferToAccountId: d.transfer ? d.transferToAccountId : null,
      categoryId: d.split.length || d.transfer ? null : d.categoryId === "rta" ? null : d.categoryId,
      lines: d.split.length ? d.split.map((l) => ({ categoryId: l.categoryId === "rta" ? null : l.categoryId, amount: outflow ? -Math.abs(parseMoney(l.amountText) ?? 0) : Math.abs(parseMoney(l.amountText) ?? 0) })) : [],
      sharedFiftyFifty: d.sharedFiftyFifty, hidden: d.hidden, trackedAmountId: d.trackedAmountId, tagIds: d.tagIds,
    };
    setBusy(true);
    try {
      if (d.id) { await api(`/transactions/${d.id}`, { method: "PUT", json: body }); toast(`Updated: ${d.payee || "entry"} ${formatMoney(Math.abs(cents))}`); }
      else {
        await api("/transactions", { method: "POST", json: body });
        const where = d.transfer ? `→ ${lists.accounts.find((a) => a.id === d.transferToAccountId)?.name}` : d.split.length ? "split" : catLabel(d.categoryId);
        toast(`Saved: ${d.payee || "entry"} ${formatMoney(Math.abs(cents))} · ${where}${d.sharedFiftyFifty ? " · 50/50" : ""}${d.hidden ? " · hidden" : ""}`);
        setD((x) => ({ ...emptyDraft(lists, me, account ?? undefined), date: x.date, accountId: x.accountId })); setOut(""); setInn(""); setDup(null);
        payeeRef.current?.focus();
      }
      if (navigator.vibrate) navigator.vibrate(10);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const enterSaves = (e: React.KeyboardEvent) => { if (e.key === "Enter") save(); else if (e.key === "Escape" && onCancel) onCancel(); };
  const fromName = lists.accounts.find((a) => a.id === d.accountId)?.name ?? "this account";
  const isNew = mode === "new";

  return (
    <div className={isNew ? "rounded-xl" : ""} style={isNew ? { background: "var(--selected)", border: "1px solid var(--navy)", boxShadow: "0 2px 8px rgba(58,79,125,0.10)" } : { background: "var(--selected)", borderBottom: "1px solid var(--border-soft)" }}
      onKeyDown={(e) => { if (e.key === "Escape" && onCancel) onCancel(); }}>
      {isNew && (
        <div className="grid items-center px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: LEDGER_COLS, gap: 10, color: "var(--accent-text)" }}>
          <span>New entry</span><span /><span>{d.transfer ? "From" : "Account"}</span><span>{d.transfer ? "To" : "Category"}</span><span /><span /><span className="text-right">Outflow</span><span className="text-right">Inflow</span><span /><span />
        </div>
      )}

      {/* the main row: the same columns as the ledger */}
      <div className="grid items-center px-4 py-2" style={{ gridTemplateColumns: LEDGER_COLS, gap: 10 }}>
        <span className="fld flex items-center rounded-md min-w-0" style={fs}>
          <input aria-label="Date" value={dateText} onChange={(e) => setDateText(e.target.value)} onBlur={commitDate} onKeyDown={(e) => { if (e.key === "Enter") commitDate(); else enterSaves(e); }} className="w-full min-w-0 px-2.5 text-[13px] bg-transparent outline-none h-full" />
          <label aria-label="Pick a date" title="Pick a date" className="relative w-7 h-full inline-flex items-center justify-center cursor-pointer shrink-0" style={{ color: "var(--muted)" }}>
            <Calendar />
            <input type="date" tabIndex={-1} value={d.date} onChange={(e) => { if (e.target.value) { set({ date: e.target.value }); setDateText(pretty(e.target.value)); } }} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
          </label>
        </span>

        <span className="relative min-w-0">
          <input ref={payeeRef} aria-label="Payee" value={d.payee} autoComplete="off"
            onChange={(e) => { set({ payee: e.target.value }); setPayeeOpen(true); }} onFocus={() => setPayeeOpen(true)} onKeyDown={onPayeeKey}
            placeholder={d.transfer ? "Payee (optional)" : "Payee"} className={field} style={fs} />
          <Popover anchor={payeeRef} open={payeeOpen && payeeMatches.length > 0} onClose={() => setPayeeOpen(false)} width={260}>
            {() => (
              <div className="py-1">
                {payeeMatches.map((p, i) => (
                  <div key={p.name} onMouseEnter={() => setPayeeHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pickPayee(p)} className="flex items-center justify-between gap-2 px-3 cursor-pointer text-[13px]" style={{ height: 32, background: i === payeeHi ? "var(--selected)" : undefined }}>
                    <span className="truncate">{p.name}</span>
                    {p.lastCategoryId && <span className="text-[11px] truncate shrink-0 max-w-[45%]" style={{ color: "var(--muted)" }}>{catLabel(p.lastCategoryId)}</span>}
                  </div>
                ))}
              </div>
            )}
          </Popover>
        </span>

        <span className="relative min-w-0 flex">
          <Select ariaLabel={d.transfer ? "From account" : "Account"} value={d.accountId} onChange={(v) => set({ accountId: v ?? d.accountId, transferToAccountId: d.transferToAccountId === v ? null : d.transferToAccountId })} options={acctOptions} className="w-full" />
        </span>

        {d.transfer ? (
          <span className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 inline-flex" style={{ color: "var(--accent-text)", transform: outflow ? undefined : "rotate(180deg)" }} title={outflow ? `Money leaves ${fromName}` : `Money arrives in ${fromName}`}><ArrowRight /></span>
            <Select ariaLabel="To account" value={d.transferToAccountId} onChange={(v) => set({ transferToAccountId: v })} options={acctOptions.filter((o) => o.value !== d.accountId)} placeholder="To account…" className="flex-1" />
          </span>
        ) : d.split.length ? (
          <span className="inline-flex items-center rounded-md px-2.5 text-[13px] font-medium" style={{ ...fs, background: "var(--group)", color: "var(--text-2)", borderStyle: "dashed" }}>Split · {d.split.length} lines</span>
        ) : (
          <Select ariaLabel="Category" value={d.categoryId} onChange={(v) => set({ categoryId: v })} options={catOptions} placeholder="Category…" className="w-full" menuWidth={300} />
        )}

        <input aria-label="Memo" value={d.memo} onChange={(e) => set({ memo: e.target.value })} onKeyDown={enterSaves} placeholder="Memo" className={field} style={fs} />
        <TagPicker lists={lists} value={d.tagIds} onChange={(tagIds) => set({ tagIds })} />
        <input aria-label="Outflow" value={out} onChange={(e) => { setOut(e.target.value); if (e.target.value) setInn(""); }} onKeyDown={enterSaves} inputMode="decimal" placeholder="0.00" className={field + " text-right"} style={fs} />
        <input aria-label="Inflow" value={inn} onChange={(e) => { setInn(e.target.value); if (e.target.value) { setOut(""); if (!d.categoryId && !d.transfer) set({ categoryId: "rta" }); } }} onKeyDown={enterSaves} inputMode="decimal" placeholder="0.00" className={field + " text-right"} style={{ ...fs, color: "var(--green-text)" }} />
        <button aria-label={isNew ? "Save entry" : "Save changes"} title={isNew ? "Save (Enter)" : "Save changes (Enter)"} onClick={save} disabled={busy} className="rounded-md inline-flex items-center justify-center text-white disabled:opacity-60 justify-self-end" style={{ height: 34, width: 60, padding: 0, lineHeight: 0, background: dup ? "var(--yellow)" : "var(--green-solid)", border: `1px solid ${dup ? "var(--yellow-text)" : "var(--green-text)"}`, boxShadow: "0 1px 2px rgba(0,0,0,0.12)", transition: "filter 100ms" }} onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.1)")} onMouseLeave={(e) => (e.currentTarget.style.filter = "")}><Check size={18} /></button>
        {onCancel ? <button aria-label="Cancel" title="Cancel (Esc)" onClick={onCancel} className="h-[34px] inline-flex items-center justify-center text-lg" style={{ color: "var(--muted)" }}>✕</button> : <span />}
      </div>

      {/* split lines slide out beneath the row */}
      <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: d.split.length ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <div className="flex flex-col gap-1.5 px-4 pb-2">
            {d.split.map((l, i) => (
              <div key={i} className="grid items-center" style={{ gridTemplateColumns: LEDGER_COLS, gap: 10 }}>
                <span /><span />
                <SplitBranch first={i === 0} last={i === d.split.length - 1} />
                <Select ariaLabel={`Split line ${i + 1} category`} value={l.categoryId} onChange={(v) => set({ split: d.split.map((x, j) => (j === i ? { ...x, categoryId: v } : x)) })} options={catOptions} placeholder="Category…" className="w-full" menuWidth={300} />
                <span className="text-[12px] truncate" style={{ color: "var(--muted)" }}>{i === d.split.length - 1 && remainder !== 0 && cents ? (remainder > 0 ? `${formatMoney(remainder)} still to place` : `${formatMoney(-remainder)} too much`) : i === d.split.length - 1 && cents ? "All placed ✓" : ""}</span>
                <span className="flex justify-end gap-2 text-[12px] font-semibold" style={{ color: "var(--accent-text)" }}>
                  {remainder > 0 && !l.amountText && <button onClick={() => set({ split: d.split.map((x, j) => (j === i ? { ...x, amountText: (remainder / 100).toFixed(2) } : x)) })}>Rest</button>}
                  {d.split.length > 2 && <button onClick={() => set({ split: d.split.filter((_, j) => j !== i) })} style={{ color: "var(--muted)" }}>Remove</button>}
                </span>
                {outflow ? <input aria-label={`Split line ${i + 1} amount`} inputMode="decimal" value={l.amountText} onChange={(e) => set({ split: d.split.map((x, j) => (j === i ? { ...x, amountText: e.target.value } : x)) })} onKeyDown={enterSaves} placeholder="0.00" className={field + " text-right"} style={fs} /> : <span />}
                {!outflow ? <input aria-label={`Split line ${i + 1} amount`} inputMode="decimal" value={l.amountText} onChange={(e) => set({ split: d.split.map((x, j) => (j === i ? { ...x, amountText: e.target.value } : x)) })} onKeyDown={enterSaves} placeholder="0.00" className={field + " text-right"} style={{ ...fs, color: "var(--green-text)" }} /> : <span />}
                <span /><span />
              </div>
            ))}
            {d.split.length > 0 && (
              <div className="grid" style={{ gridTemplateColumns: LEDGER_COLS, gap: 10 }}>
                <span /><span /><span />
                <button onClick={() => set({ split: [...d.split, { categoryId: null, amountText: remainder > 0 ? (remainder / 100).toFixed(2) : "" }] })} className="text-left text-[12px] font-semibold" style={{ color: "var(--accent-text)" }}>+ Another line</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* options row */}
      <div className="flex items-center flex-wrap gap-2 px-4 pb-3 pt-1 text-xs" style={{ color: "var(--text-2)" }}>
        <button type="button" aria-pressed={d.sharedFiftyFifty} title="Half of this is owed by the other checking" onClick={() => set({ sharedFiftyFifty: !d.sharedFiftyFifty })} className={pillCls} style={pill(d.sharedFiftyFifty)}><span className="tb">50/50</span></button>
        <button type="button" aria-pressed={d.hidden} title="Keep this entry out of the shared view" onClick={() => set({ hidden: !d.hidden })} className={pillCls} style={pill(d.hidden)}><span className="tb">Hidden</span></button>
        <button type="button" aria-pressed={d.split.length > 0} title="Split the amount across categories" onClick={toggleSplit} className={pillCls} style={pill(d.split.length > 0, d.transfer)} disabled={d.transfer}><span className="tb">Split</span></button>
        <button type="button" aria-pressed={d.transfer} title="Move money between two accounts" onClick={toggleTransfer} className={pillCls} style={pill(d.transfer, d.split.length > 0)} disabled={d.split.length > 0}><span className="tb">Transfer</span></button>
        {trackedOptions.length > 0 && <Select ariaLabel="Track against" pill on={!!d.trackedAmountId} value={d.trackedAmountId} onChange={(v) => set({ trackedAmountId: v })} options={[{ value: "", label: "Not tracked" }, ...trackedOptions]} placeholder="Track against…" />}
        {d.sharedFiftyFifty && cents > 0 && <span className="ml-2" style={{ color: "var(--muted)" }}>Other checking owes {formatMoney(Math.round(cents / 2))}</span>}
        {dup && <span style={{ color: "var(--yellow-text)" }}>⚠ Possible duplicate: {dup.payee} {formatMoney(Math.abs(dup.amount))} on {pretty(dup.date)}</span>}
        {err && <span className="font-semibold" style={{ color: "var(--red-text)" }}>{err}</span>}
        {onDelete && <button onClick={onDelete} className="ml-auto font-semibold" style={{ color: "var(--red-text)" }}>Delete entry</button>}
      </div>
    </div>
  );
}

/** The connector drawn in the Account column of each split line: a 1px stem under the account box that forks into each category. */
function SplitBranch({ first, last }: { first: boolean; last: boolean }) {
  const line = { background: "var(--accent-text)" } as const;
  return (
    <span className="relative block h-[34px] min-w-0" aria-hidden="true" style={{ color: "var(--accent-text)" }}>
      {/* vertical: starts 5px clear of the account box on the first line, runs through the 6px gap to the next line, stops at the elbow on the last */}
      <span className="absolute w-px" style={{ ...line, left: 12, top: first ? -3 : -6, bottom: last ? 17 : -6 }} />
      <span className="absolute h-px" style={{ ...line, left: 12, right: 7, top: 17 }} />
      <svg className="absolute" style={{ right: 0, top: 13 }} width="8" height="9" viewBox="0 0 8 9" fill="currentColor"><path d="M0 0.5 L8 4.5 L0 8.5 Z" /></svg>
    </span>
  );
}

/** Multi-select of tags, shown as coloured chips in the Tags column. */
function TagPicker({ lists, value, onChange }: { lists: Lists; value: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const chosen = lists.tags.filter((t) => value.includes(t.id));
  async function add() {
    const name = draft.trim(); if (!name) return;
    const tag = await createTag(name); setDraft("");
    if (!value.includes(tag.id)) onChange([...value, tag.id]);
  }
  return (
    <>
      <button ref={btn} type="button" aria-label="Tags" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="fld flex items-center gap-1 rounded-md px-2 min-w-0 w-full overflow-hidden text-left" style={{ ...fs, color: chosen.length ? "var(--text)" : "var(--faint)" }}>
        {chosen.length === 0 && <span className="text-[13px] truncate">Tags</span>}
        {chosen.map((t) => <span key={t.id} className="px-1.5 rounded-full text-[10px] font-semibold shrink-0 leading-4" style={{ background: t.color, color: "#1A1D23" }}>{t.name}</span>)}
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={200}>
        {() => (
          <div className="py-1">
            {lists.tags.length === 0 && <div className="px-3 py-1.5 text-xs" style={{ color: "var(--muted)" }}>No tags yet — make one below.</div>}
            {lists.tags.map((t) => {
              const on = value.includes(t.id);
              return (
                <label key={t.id} className="flex items-center gap-2.5 px-3 cursor-pointer text-[13px]" style={{ height: 32 }}>
                  <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])} />
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="truncate">{t.name}</span>
                </label>
              );
            })}
            <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1" style={{ borderTop: "1px solid var(--border-soft)" }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="New tag…" className="fld flex-1 min-w-0 rounded-md px-2 text-[13px] outline-none" style={{ height: 30, border: "1px solid var(--field)", background: "var(--card)" }} />
              <button type="button" onClick={add} disabled={!draft.trim()} className="rounded-md px-2.5 text-xs font-semibold disabled:opacity-50" style={{ height: 30, background: "var(--navy)", color: "var(--navy-text)" }}>Add</button>
            </div>
          </div>
        )}
      </Popover>
    </>
  );
}

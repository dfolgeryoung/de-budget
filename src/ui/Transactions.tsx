import { useEffect, useMemo, useState } from "react";
import { api, categoryOptions, type Lists } from "./api";
import { formatMoney } from "../budget/money";
import { useToast } from "./Toast";
import type { LedgerRow } from "../server/transactions";
import { EntryForm, draftFromRow, emptyDraft, type EntryDraft } from "./EntryForm";
import { Sheet } from "./Sheet";
import { EntryRow, LEDGER_COLS } from "./EntryRow";
import type { MonthPayload } from "../server/month";
import { Select } from "./Select";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayLabel = (d: string) => { const dt = new Date(d + "T12:00:00"); return `${DAY[dt.getDay()]}, ${MON[dt.getMonth()]} ${dt.getDate()}`; };
const short = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

export function Transactions({ me, lists, openEntry, refreshKey, account, setAccount }: {
  me: { id: string; initial?: string; avatarEmoji?: string }; lists: Lists; openEntry: (d: EntryDraft) => void; refreshKey: number; account: string | null; setAccount: (id: string | null) => void;
}) {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [month, setMonth] = useState<string>("");
  const [tag, setTag] = useState<string | null>(null);
  const [onlyHidden, setOnlyHidden] = useState(false);
  const [onlyMismatch, setOnlyMismatch] = useState(false);
  const isDesktop = typeof matchMedia !== "undefined" && matchMedia("(min-width: 768px)").matches;
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [moreFilters, setMoreFilters] = useState(false);
  useEffect(() => { if (isDesktop) return; api<MonthPayload>("/month").then((m) => setBalances(new Map(m.accounts.map((a) => [a.id, a.balance])))).catch(() => {}); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [prefill, setPrefill] = useState<EntryDraft | undefined>(undefined);
  const toast = useToast();
  const catName = useMemo(() => new Map(lists.groups.flatMap((g) => g.categories.map((c) => [c.id, `${c.emoji ? c.emoji + " " : ""}${c.name}`]))), [lists]);
  const acctName = useMemo(() => new Map(lists.accounts.map((a) => [a.id, a.name])), [lists]);
  const tagById = useMemo(() => new Map(lists.tags.map((t) => [t.id, t])), [lists]);

  const load = () => {
    const p = new URLSearchParams();
    if (account) p.set("account", account);
    if (category) p.set("category", category);
    if (month) p.set("month", month);
    if (q) p.set("q", q);
    p.set("limit", "300");
    api<LedgerRow[]>(`/transactions?${p}`).then(setRows).catch((e) => toast(String(e)));
  };
  useEffect(load, [account, category, month, q, refreshKey]);
  const shown = (rows ?? []).filter((r) => (!tag || r.tagIds.includes(tag)) && (!onlyHidden || r.hidden) && (!onlyMismatch || r.bankStatus === "mismatch"));
  const monthOptions = (() => { const out: string[] = []; const d = new Date(); for (let i = 0; i < 14; i++) { const m = new Date(d.getFullYear(), d.getMonth() + 1 - i, 1); out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-01`); } return out; })();

  async function del(r: LedgerRow) {
    setMenu(null);
    await api(`/transactions/${r.id}`, { method: "DELETE" });
    load();
    toast(`Deleted: ${r.payee ?? "entry"} ${r.amount != null ? formatMoney(Math.abs(r.amount)) : ""}`, async () => { await api(`/transactions/${r.id}?undo=1`, { method: "DELETE" }); load(); });
  }

  const groups: { day: string; rows: LedgerRow[] }[] = [];
  for (const r of shown) {
    const g = groups[groups.length - 1];
    if (g && g.day === r.date) g.rows.push(r); else groups.push({ day: r.date, rows: [r] });
  }
  const acct = account ? lists.accounts.find((a) => a.id === account) : null;

  if (!isDesktop) {
    const hp = { height: 32, padding: "0 11px", fontSize: 12 } as const;
    const hpOff = { ...hp, background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,0.35)", fontWeight: 500 };
    const hpOn = { ...hp, background: "#fff", color: "var(--rail)", border: "1px solid #fff", fontWeight: 600 };
    const catOpts = [{ value: "", label: "All categories" }, ...categoryOptions(lists, { all: true })];
    const cols = account ? "minmax(0,1fr) 88px 80px" : "minmax(0,1fr) 100px";
    return (
      <div className="flex flex-col -mx-4">
        <div className="relative px-5 pb-3.5 flex flex-col" style={{ background: "var(--rail)", color: "#fff", paddingTop: "calc(1rem + env(safe-area-inset-top))", gap: 12 }}>
          <div className="flex items-center justify-between">
            <h1 className="text-[22px] font-bold">{acct ? acct.name : "Transactions"}</h1>
            <button aria-label="More filters" aria-pressed={moreFilters} onClick={() => setMoreFilters((v) => !v)} className="w-11 h-11 rounded-full inline-flex items-center justify-center" style={{ background: moreFilters || onlyHidden || onlyMismatch ? "#fff" : "rgba(255,255,255,0.12)", color: moreFilters || onlyHidden || onlyMismatch ? "var(--rail)" : "#fff" }}>
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="18" x2="14" y2="18" /></svg>
            </button>
          </div>
          <label className="flex items-center gap-2 rounded-[10px]" style={{ background: "rgba(255,255,255,0.12)", padding: "10px 12px" }}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ opacity: 0.85 }}><circle cx="11" cy="11" r="7" /><line x1="20" y1="20" x2="16.5" y2="16.5" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee, memo, amount" className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-white placeholder:text-white/60" />
          </label>
          <div className="no-bar flex gap-1.5 overflow-x-auto -mx-5 px-5">
            <Select pill ariaLabel="Account filter" value={account} onChange={setAccount} options={[{ value: "", label: "All accounts" }, ...lists.accounts.map((a) => ({ value: a.id, label: balances.has(a.id) ? `${a.name} · ${formatMoney(balances.get(a.id)!)}` : a.name }))]} style={account ? hpOn : hpOff} />
            <Select pill ariaLabel="Category filter" value={category} onChange={setCategory} placeholder="Category" menuWidth={280} options={catOpts} style={category ? hpOn : hpOff} />
            <Select pill ariaLabel="Month filter" value={month || ""} onChange={(v) => setMonth(v ?? "")} placeholder="Month" searchable={false} options={[{ value: "", label: "All months" }, ...monthOptions.map((m) => ({ value: m, label: `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` }))]} style={month ? hpOn : hpOff} />
            {lists.tags.length > 0 && <Select pill ariaLabel="Tag filter" value={tag} onChange={setTag} placeholder="Tags" options={[{ value: "", label: "All tags" }, ...lists.tags.map((t) => ({ value: t.id, label: t.name }))]} style={tag ? hpOn : hpOff} />}
            {(moreFilters || onlyHidden) && <button onClick={() => setOnlyHidden((v) => !v)} className="pill" style={onlyHidden ? hpOn : hpOff}><span className="tb">Hidden only</span></button>}
            {(moreFilters || onlyMismatch) && <button onClick={() => setOnlyMismatch((v) => !v)} className="pill" style={onlyMismatch ? hpOn : hpOff}><span className="tb">Bank mismatches</span></button>}
          </div>
        </div>

        <div className="grid px-4 pt-2 pb-1 text-[11px] font-semibold uppercase" style={{ gridTemplateColumns: cols, color: "var(--muted)", letterSpacing: "0.06em" }}>
          <span>Entry</span><span className="text-right">Amount</span>{account && <span className="text-right">Balance</span>}
        </div>
        {rows === null && <div className="px-4 py-3 text-sm" style={{ color: "var(--muted)" }}>Loading…</div>}
        {rows?.length === 0 && <div className="px-4 py-3 text-sm" style={{ color: "var(--muted)" }}>No entries match.</div>}
        {groups.map((g) => (
          <div key={g.day}>
            <div className="px-4 pt-2.5 pb-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>{dayLabel(g.day)}</div>
            <div style={{ background: "var(--card)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
              {g.rows.map((r, i) => {
                const masked = r.amount === null;
                const isTransfer = !!r.transferToAccountId;
                const cats = isTransfer ? `⇄ Transfer${account === r.transferToAccountId ? ` from ${acctName.get(r.accountId)}` : ` to ${acctName.get(r.transferToAccountId!)}`}` : r.lines.length > 1 ? "Split across categories" : (r.lines[0]?.categoryId ? catName.get(r.lines[0].categoryId) : "Ready to Assign");
                const shownAmount = r.amount === null ? null : account && r.transferToAccountId === account ? -r.amount : r.amount;
                return (
                  <button key={r.id} onClick={() => !masked && openEntry(draftFromRow(r, lists))} className="w-full grid items-center text-left" style={{ gridTemplateColumns: cols, padding: "11px 16px", borderTop: i ? "1px solid var(--border-soft)" : undefined, background: r.bankStatus === "mismatch" ? "var(--yellow-row)" : masked ? "var(--card-alt)" : undefined }}>
                    <span className="flex flex-col min-w-0" style={{ gap: 2 }}>
                      <span className="text-[15px] font-medium flex items-center gap-1.5 truncate" style={{ color: masked ? "var(--muted)" : undefined }}>
                        {masked && <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>}
                        <span className="truncate">{masked ? "[Hidden]" : r.payee || (isTransfer ? "Transfer" : "—")}</span>
                        {r.hidden && r.mine && <span title="Hidden from the other person" className="text-xs">🔒</span>}
                        {r.bankStatus === "mismatch" && <span title={r.bankNote ?? "Doesn't match the bank"} className="text-xs" style={{ color: "var(--neg)" }}>⚠</span>}
                      </span>
                      <span className="text-xs flex items-center gap-1.5 min-w-0" style={{ color: "var(--muted)" }}>
                        <span className="truncate">{!account && !masked ? `${acctName.get(r.accountId)} · ` : ""}{cats}{r.memo ? ` · ${r.memo}` : ""}</span>
                        {r.source === "recurring" && <span aria-label="Recurring" className="inline-flex w-4 h-4 rounded-full text-[9px] font-bold items-center justify-center shrink-0" style={{ border: "1.5px solid var(--muted)" }}>R</span>}
                        {r.sharedFiftyFifty && <span className="px-1.5 rounded-full text-[10px] font-semibold shrink-0" style={{ background: "var(--group)", color: "var(--text-2)" }}>50/50</span>}
                        {r.tagIds.map((id) => tagById.get(id)).filter(Boolean).map((tg) => <span key={tg!.id} className="px-1.5 rounded-full text-[10px] font-semibold shrink-0" style={{ background: tg!.color, color: "#1A1D23" }}>{tg!.name}</span>)}
                      </span>
                    </span>
                    <span className="text-right text-[15px] font-semibold" style={{ color: shownAmount === null ? "var(--faint)" : shownAmount < 0 ? "var(--neg)" : "var(--green-text)" }}>{shownAmount === null ? "—" : (shownAmount > 0 ? "+" : "") + formatMoney(shownAmount)}</span>
                    {account && <span className="text-right text-[13px]" style={{ color: "var(--muted)" }}>{r.balance !== null ? formatMoney(r.balance) : ""}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{acct ? acct.name : "Transactions"}</h1>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee, memo, amount" className="fld rounded-lg px-3 py-2 text-sm w-full md:w-72 outline-none" style={{ border: "1px solid var(--field)", background: "var(--card)" }} />
      </div>
      <div className="no-bar flex items-center gap-2 overflow-x-auto pb-1">
        <Select pill on={!!account} ariaLabel="Account filter" value={account} onChange={setAccount} options={[{ value: "", label: "All accounts" }, ...lists.accounts.map((a) => ({ value: a.id, label: a.name }))]} style={{ maxWidth: "14rem" }} />
        <Select pill on={!!category} ariaLabel="Category filter" value={category} onChange={setCategory} placeholder="Category" menuWidth={280} options={[{ value: "", label: "All categories" }, ...categoryOptions(lists, { all: true })]} style={{ maxWidth: "14rem" }} />
        <Select pill on={!!month} ariaLabel="Month filter" value={month || ""} onChange={(v) => setMonth(v ?? "")} options={[{ value: "", label: "All months" }, ...monthOptions.map((m) => ({ value: m, label: `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` }))]} searchable={false} />
        {lists.tags.length > 0 && <Select pill on={!!tag} ariaLabel="Tag filter" value={tag} onChange={setTag} placeholder="Tags" options={[{ value: "", label: "All tags" }, ...lists.tags.map((t) => ({ value: t.id, label: t.name }))]} />}
        <button onClick={() => setOnlyHidden((v) => !v)} className={"pill" + (onlyHidden ? " on" : "")} style={{ background: onlyHidden ? "var(--navy)" : "var(--card)", color: onlyHidden ? "var(--navy-text)" : "var(--text-2)", border: `1px solid ${onlyHidden ? "var(--navy)" : "var(--field)"}` }}><span className="tb">Hidden only</span></button>
        <button onClick={() => setOnlyMismatch((v) => !v)} className={"pill" + (onlyMismatch ? " on" : "")} style={{ background: onlyMismatch ? "var(--navy)" : "var(--card)", color: onlyMismatch ? "var(--navy-text)" : "var(--text-2)", border: `1px solid ${onlyMismatch ? "var(--navy)" : "var(--field)"}` }}><span className="tb">Bank mismatches</span></button>
      </div>

      {isDesktop && <EntryRow key="new" mode="new" lists={lists} me={me} account={account} initial={prefill} onSaved={() => { setPrefill(undefined); load(); }} />}

      <div className="rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {isDesktop && (
          <div className="grid px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: LEDGER_COLS, gap: 10, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
            <span>Date</span><span>Payee</span><span>Account</span><span>Category</span><span>Memo</span><span>Tags</span><span className="text-right">Outflow</span><span className="text-right">Inflow</span><span className="text-right">Balance</span><span />
          </div>
        )}
        {rows === null && <div className="p-4 text-sm" style={{ color: "var(--muted)" }}>Loading…</div>}
        {rows?.length === 0 && <div className="p-4 text-sm" style={{ color: "var(--muted)" }}>No entries match.</div>}
        {groups.map((g) => (
          <div key={g.day}>
            <div className="px-4 py-1.5 text-[11px] font-semibold" style={{ color: "var(--muted)", background: "var(--card-alt)", borderBottom: "1px solid var(--border-soft)" }}>{dayLabel(g.day)}</div>
            {g.rows.map((r) => {
              const masked = r.amount === null;
              const isTransfer = !!r.transferToAccountId;
              const cats = isTransfer ? `⇄ Transfer${account === r.transferToAccountId ? ` from ${acctName.get(r.accountId)}` : ` to ${acctName.get(r.transferToAccountId!)}`}` : r.lines.length > 1 ? "Split across categories" : (r.lines[0]?.categoryId ? catName.get(r.lines[0].categoryId) : "Ready to Assign");
              const shownAmount = r.amount === null ? null : account && r.transferToAccountId === account ? -r.amount : r.amount;
              return (
                isDesktop && editing === r.id ? (
                <EntryRow key={r.id} mode="edit" lists={lists} me={me} account={account} initial={draftFromRow(r, lists)} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} onDelete={() => { setEditing(null); del(r); }} />
                ) : isDesktop ? (
                <div key={r.id} onClick={(e) => { if (!masked && !(e.target as HTMLElement).closest("button")) setEditing(r.id); }} className={"row-hover relative grid items-center px-4 py-2 text-[13px]" + (masked ? "" : " cursor-pointer")} title={masked ? undefined : "Click to edit"} style={{ gridTemplateColumns: LEDGER_COLS, gap: 10, borderBottom: "1px solid var(--border-soft)", background: r.bankStatus === "mismatch" ? "var(--yellow-row)" : masked ? "var(--card-alt)" : undefined }}>
                  <span style={{ color: "var(--muted)" }}>{short(r.date)}</span>
                  <span className="min-w-0 text-left font-medium truncate flex items-center gap-1.5" style={{ color: masked ? "var(--muted)" : undefined }}>
                    {masked && "🔒 "}{r.payee || (isTransfer ? "Transfer" : "—")}
                    {r.hidden && r.mine && <span title="Hidden from the other person">🔒</span>}
                    {r.source === "recurring" && <span className="inline-flex w-4 h-4 rounded-full text-[9px] font-bold items-center justify-center" style={{ border: "1.5px solid var(--muted)", color: "var(--muted)" }}>R</span>}
                    {r.bankStatus === "mismatch" && <span title={r.bankNote ?? "Doesn't match the bank"} style={{ color: "var(--neg)" }}>⚠</span>}
                    {r.sharedFiftyFifty && <span className="px-1.5 rounded-full text-[10px] font-semibold" style={{ background: "var(--group)", color: "var(--text-2)" }}>50/50</span>}
                  </span>
                  <span className="truncate" style={{ color: "var(--text-2)" }}>{acctName.get(r.accountId)}</span>
                  <span className="truncate">{cats}</span>
                  <span className="truncate" style={{ color: "var(--muted)" }}>{r.memo ?? ""}</span>
                  <span className="flex gap-1 flex-wrap">{r.tagIds.map((id) => tagById.get(id)).filter(Boolean).map((tg) => <button key={tg!.id} onClick={() => setTag(tg!.id)} className="px-1.5 rounded-full text-[10px] font-semibold" style={{ background: tg!.color, color: "#1A1D23" }}>{tg!.name}</button>)}</span>
                  <span className="text-right">{shownAmount !== null && shownAmount < 0 ? formatMoney(-shownAmount) : shownAmount === null ? "—" : ""}</span>
                  <span className="text-right" style={{ color: "var(--green-text)" }}>{shownAmount !== null && shownAmount > 0 ? formatMoney(shownAmount) : ""}</span>
                  <span className="text-right" style={{ color: "var(--muted)" }}>{account && r.balance !== null ? formatMoney(r.balance) : ""}</span>
                  <button aria-label="Row menu" onClick={() => setMenu(menu === r.id ? null : r.id)} className="text-right" style={{ color: "var(--faint)" }} disabled={masked}>⋯</button>
                  {menu === r.id && (
                    <div className="absolute right-4 top-9 z-10 rounded-lg shadow-lg text-sm flex flex-col" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                      <button className="px-4 py-2 text-left" onClick={() => { setMenu(null); setEditing(r.id); }}>Edit</button>
                      <button className="px-4 py-2 text-left" onClick={() => { setMenu(null); const d = draftFromRow(r, lists); delete d.id; setPrefill({ ...d, more: true }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Duplicate</button>
                      <button className="px-4 py-2 text-left" style={{ color: "var(--red-text)" }} onClick={() => del(r)}>Delete</button>
                    </div>
                  )}
                </div>
                ) : (
                <div key={r.id} className="relative grid items-center px-4 py-2.5 text-sm" style={{ gridTemplateColumns: account ? "minmax(0,1fr) 96px 88px 32px" : "minmax(0,1fr) 96px 32px", borderBottom: "1px solid var(--border-soft)", background: r.bankStatus === "mismatch" ? "var(--yellow-row)" : masked ? "var(--card-alt)" : undefined }}>
                  <button onClick={() => !masked && openEntry(draftFromRow(r, lists))} className="min-w-0 text-left flex flex-col gap-0.5">
                    <span className="font-medium flex items-center gap-1.5 truncate" style={{ color: masked ? "var(--muted)" : undefined }}>
                      {masked && "🔒 "}{r.payee || (isTransfer ? "Transfer" : "—")}
                      {r.hidden && r.mine && <span title="Hidden from the other person">🔒</span>}
                      {r.source === "recurring" && <span className="inline-flex w-4 h-4 rounded-full text-[9px] font-bold items-center justify-center" style={{ border: "1.5px solid var(--muted)", color: "var(--muted)" }}>R</span>}
                      {r.bankStatus === "mismatch" && <span title={r.bankNote ?? "Doesn't match the bank"} style={{ color: "var(--neg)" }}>⚠</span>}
                    </span>
                    <span className="text-xs flex items-center gap-1.5 flex-wrap" style={{ color: "var(--muted)" }}>
                      {!account && <span>{acctName.get(r.accountId)} · </span>}
                      <span>{cats}</span>
                      {r.memo && <span>· {r.memo}</span>}
                      {r.sharedFiftyFifty && <span className="px-1.5 rounded-full text-[10px] font-semibold" style={{ background: "var(--group)", color: "var(--text-2)" }}>50/50</span>}
                      {r.tagIds.map((id) => tagById.get(id)).filter(Boolean).map((tg) => <span key={tg!.id} className="px-1.5 rounded-full text-[10px] font-semibold" style={{ background: tg!.color, color: "#1A1D23" }}>{tg!.name}</span>)}
                    </span>
                  </button>
                  <span className="text-right font-semibold" style={{ color: shownAmount === null ? "var(--faint)" : shownAmount < 0 ? "var(--neg)" : "var(--green-text)" }}>{shownAmount === null ? "—" : (shownAmount > 0 ? "+" : "") + formatMoney(shownAmount)}</span>
                  {account && <span className="text-right text-xs" style={{ color: "var(--muted)" }}>{r.balance !== null ? formatMoney(r.balance) : ""}</span>}
                  <button aria-label="Row menu" onClick={() => setMenu(menu === r.id ? null : r.id)} className="text-right" style={{ color: "var(--faint)" }} disabled={masked}>⋯</button>
                  {menu === r.id && (
                    <div className="absolute right-4 top-9 z-10 rounded-lg shadow-lg text-sm flex flex-col" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                      <button className="px-4 py-2 text-left" onClick={() => { setMenu(null); openEntry(draftFromRow(r, lists)); }}>Edit</button>
                      <button className="px-4 py-2 text-left" onClick={() => { setMenu(null); const d = draftFromRow(r, lists); delete d.id; openEntry(d); }}>Duplicate</button>
                      <button className="px-4 py-2 text-left" style={{ color: "var(--red-text)" }} onClick={() => del(r)}>Delete</button>
                    </div>
                  )}
                </div>
                )
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Entry sheet/panel wrapper used by the shell. */
export function EntrySheet({ lists, me, draft, onClose, onSaved, onDeleted }: { lists: Lists; me: { id: string; initial?: string }; draft: EntryDraft | null; onClose: () => void; onSaved: (id: string, summary: string) => void; onDeleted?: () => void }) {
  const toast = useToast();
  if (!draft) return null;
  async function del(id: string) {
    await api(`/transactions/${id}`, { method: "DELETE" });
    onClose(); onDeleted?.();
    toast(`Deleted: ${draft!.payee || "entry"} ${draft!.amountText ? "$" + draft!.amountText : ""}`.trim(), async () => { await api(`/transactions/${id}?undo=1`, { method: "DELETE" }); onDeleted?.(); });
  }
  return (
    <Sheet onClose={onClose}>
      <EntryForm lists={lists} me={me} initial={draft} onClose={onClose} onSaved={onSaved} onDelete={del} />
    </Sheet>
  );
}

export { emptyDraft };

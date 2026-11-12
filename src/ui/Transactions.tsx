import { useEffect, useMemo, useState } from "react";
import { api, type Lists } from "./api";
import { formatMoney } from "../budget/money";
import { useToast } from "./Toast";
import type { LedgerRow } from "../server/transactions";
import { EntryForm, draftFromRow, emptyDraft, type EntryDraft } from "./EntryForm";
import { Sheet } from "./Sheet";
import { QuickEntry } from "./QuickEntry";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayLabel = (d: string) => { const dt = new Date(d + "T12:00:00"); return `${DAY[dt.getDay()]}, ${MON[dt.getMonth()]} ${dt.getDate()}`; };
const short = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

export function Transactions({ me, lists, openEntry, refreshKey, account, setAccount }: {
  me: { id: string; initial?: string }; lists: Lists; openEntry: (d: EntryDraft) => void; refreshKey: number; account: string | null; setAccount: (id: string | null) => void;
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{acct ? acct.name : "Transactions"}</h1>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee, memo, amount" className="rounded-lg px-3 py-2 text-sm w-full md:w-72 outline-none" style={{ border: "1px solid var(--field)", background: "var(--card)" }} />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <select value={account ?? ""} onChange={(e) => setAccount(e.target.value || null)} className={"sel rounded-full pl-3 py-1.5 text-xs font-semibold w-auto shrink-0" + (account ? " on" : "")} style={{ maxWidth: "14rem", backgroundColor: account ? "var(--navy)" : "var(--card)", color: account ? "var(--navy-text)" : "var(--text-2)", border: "1px solid var(--field)" }}>
          <option value="">All accounts</option>
          {lists.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={category ?? ""} onChange={(e) => setCategory(e.target.value || null)} className={"sel rounded-full pl-3 py-1.5 text-xs font-semibold w-auto shrink-0" + (category ? " on" : "")} style={{ maxWidth: "14rem", backgroundColor: category ? "var(--navy)" : "var(--card)", color: category ? "var(--navy-text)" : "var(--text-2)", border: "1px solid var(--field)" }}>
          <option value="">Category</option>
          {lists.groups.map((g) => <optgroup key={g.id} label={g.name}>{g.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
        </select>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className={"sel rounded-full pl-3 py-1.5 text-xs font-semibold w-auto shrink-0" + (month ? " on" : "")} style={{ backgroundColor: month ? "var(--navy)" : "var(--card)", color: month ? "var(--navy-text)" : "var(--text-2)", border: "1px solid var(--field)" }}>
          <option value="">All months</option>
          {monthOptions.map((m) => <option key={m} value={m}>{MON[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}</option>)}
        </select>
        {lists.tags.length > 0 && (
          <select value={tag ?? ""} onChange={(e) => setTag(e.target.value || null)} className={"sel rounded-full pl-3 py-1.5 text-xs font-semibold w-auto shrink-0" + (tag ? " on" : "")} style={{ backgroundColor: tag ? "var(--navy)" : "var(--card)", color: tag ? "var(--navy-text)" : "var(--text-2)", border: "1px solid var(--field)" }}>
            <option value="">Tags</option>
            {lists.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <button onClick={() => setOnlyHidden((v) => !v)} className="rounded-full px-3 py-1.5 text-xs font-semibold shrink-0" style={{ background: onlyHidden ? "var(--navy)" : "var(--card)", color: onlyHidden ? "var(--navy-text)" : "var(--text-2)", border: "1px solid var(--field)" }}>Hidden only</button>
        <button onClick={() => setOnlyMismatch((v) => !v)} className="rounded-full px-3 py-1.5 text-xs font-semibold shrink-0" style={{ background: onlyMismatch ? "var(--navy)" : "var(--card)", color: onlyMismatch ? "var(--navy-text)" : "var(--text-2)", border: "1px solid var(--field)" }}>Bank mismatches</button>
      </div>

      {isDesktop && <QuickEntry lists={lists} me={me} account={account} onSaved={() => { load(); }} openFull={openEntry} />}

      <div className="rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {isDesktop && (
          <div className="grid px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: "64px minmax(130px,1.2fr) 120px minmax(140px,1fr) minmax(80px,0.9fr) 100px 90px 90px 96px 28px", gap: 10, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
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
                isDesktop ? (
                <div key={r.id} className="relative grid items-center px-4 py-2 text-[13px]" style={{ gridTemplateColumns: "64px minmax(130px,1.2fr) 120px minmax(140px,1fr) minmax(80px,0.9fr) 100px 90px 90px 96px 28px", gap: 10, borderBottom: "1px solid var(--border-soft)", background: r.bankStatus === "mismatch" ? "var(--yellow-row)" : masked ? "var(--card-alt)" : undefined }}>
                  <span style={{ color: "var(--muted)" }}>{short(r.date)}</span>
                  <button onClick={() => !masked && openEntry(draftFromRow(r, lists))} className="min-w-0 text-left font-medium truncate flex items-center gap-1.5" style={{ color: masked ? "var(--muted)" : undefined }}>
                    {masked && "🔒 "}{r.payee || (isTransfer ? "Transfer" : "—")}
                    {r.hidden && r.mine && <span title="Hidden from the other person">🔒</span>}
                    {r.source === "recurring" && <span className="inline-flex w-4 h-4 rounded-full text-[9px] font-bold items-center justify-center" style={{ border: "1.5px solid var(--muted)", color: "var(--muted)" }}>R</span>}
                    {r.bankStatus === "mismatch" && <span title={r.bankNote ?? "Doesn't match the bank"} style={{ color: "var(--neg)" }}>⚠</span>}
                    {r.sharedFiftyFifty && <span className="px-1.5 rounded-full text-[10px] font-semibold" style={{ background: "var(--group)", color: "var(--text-2)" }}>50/50</span>}
                  </button>
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
                      <button className="px-4 py-2 text-left" onClick={() => { setMenu(null); openEntry(draftFromRow(r, lists)); }}>Edit</button>
                      <button className="px-4 py-2 text-left" onClick={() => { setMenu(null); const d = draftFromRow(r, lists); delete d.id; openEntry(d); }}>Duplicate</button>
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
export function EntrySheet({ lists, me, draft, onClose, onSaved }: { lists: Lists; me: { id: string; initial?: string }; draft: EntryDraft | null; onClose: () => void; onSaved: (id: string, summary: string) => void }) {
  if (!draft) return null;
  return (
    <Sheet onClose={onClose}>
      <EntryForm lists={lists} me={me} initial={draft} onClose={onClose} onSaved={onSaved} />
    </Sheet>
  );
}

export { emptyDraft };

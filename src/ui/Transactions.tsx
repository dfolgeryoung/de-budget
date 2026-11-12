import { useEffect, useMemo, useState } from "react";
import { api, type Lists } from "./api";
import { formatMoney } from "../budget/money";
import { useToast } from "./Toast";
import type { LedgerRow } from "../server/transactions";
import { EntryForm, draftFromRow, emptyDraft, type EntryDraft } from "./EntryForm";
import { Sheet } from "./Sheet";

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
  const [menu, setMenu] = useState<string | null>(null);
  const toast = useToast();
  const catName = useMemo(() => new Map(lists.groups.flatMap((g) => g.categories.map((c) => [c.id, `${c.emoji ? c.emoji + " " : ""}${c.name}`]))), [lists]);
  const acctName = useMemo(() => new Map(lists.accounts.map((a) => [a.id, a.name])), [lists]);
  const tagById = useMemo(() => new Map(lists.tags.map((t) => [t.id, t])), [lists]);

  const load = () => {
    const p = new URLSearchParams();
    if (account) p.set("account", account);
    if (category) p.set("category", category);
    if (q) p.set("q", q);
    p.set("limit", "300");
    api<LedgerRow[]>(`/transactions?${p}`).then(setRows).catch((e) => toast(String(e)));
  };
  useEffect(load, [account, category, q, refreshKey]);

  async function del(r: LedgerRow) {
    setMenu(null);
    await api(`/transactions/${r.id}`, { method: "DELETE" });
    load();
    toast(`Deleted: ${r.payee ?? "entry"} ${r.amount != null ? formatMoney(Math.abs(r.amount)) : ""}`, async () => { await api(`/transactions/${r.id}?undo=1`, { method: "DELETE" }); load(); });
  }

  const groups: { day: string; rows: LedgerRow[] }[] = [];
  for (const r of rows ?? []) {
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
        <select value={account ?? ""} onChange={(e) => setAccount(e.target.value || null)} className={"sel rounded-full pl-3 py-1.5 text-xs font-semibold w-auto shrink-0" + (account ? " on" : "")} style={{ maxWidth: "14rem", background: account ? "var(--navy)" : "var(--card)", color: account ? "var(--navy-text)" : "var(--text-2)", border: "1px solid var(--field)" }}>
          <option value="">All accounts</option>
          {lists.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={category ?? ""} onChange={(e) => setCategory(e.target.value || null)} className={"sel rounded-full pl-3 py-1.5 text-xs font-semibold w-auto shrink-0" + (category ? " on" : "")} style={{ maxWidth: "14rem", background: category ? "var(--navy)" : "var(--card)", color: category ? "var(--navy-text)" : "var(--text-2)", border: "1px solid var(--field)" }}>
          <option value="">Category</option>
          {lists.groups.map((g) => <optgroup key={g.id} label={g.name}>{g.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
        </select>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
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

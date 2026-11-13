import { useEffect, useState } from "react";
import { api, todayISO, type Lists } from "./api";
import { formatMoney } from "../budget/money";
import { weeklyAllowance } from "../budget/engine";
import { useToast } from "./Toast";
import type { MonthPayload } from "../server/month";
import type { LedgerRow } from "../server/transactions";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function Home({ me, lists, refreshKey, goTransactions, openEdit }: { me: { name: string; initial?: string }; lists: Lists; refreshKey: number; goTransactions: (account: string | null) => void; openEdit?: (id: string) => void }) {
  const [m, setM] = useState<MonthPayload | null>(null);
  const [recent, setRecent] = useState<LedgerRow[] | null>(null);
  const [pend, setPend] = useState<{ id: string; date: string; accountId: string; payee: string | null; amount: number; categoryId: string | null }[]>([]);
  const [bump, setBump] = useState(0);
  const toast = useToast();
  useEffect(() => {
    api<MonthPayload>("/month").then(setM).catch(() => setM(null));
    api<LedgerRow[]>("/transactions?limit=4").then(setRecent).catch(() => setRecent([]));
    api<typeof pend>("/pending").then((p) => setPend(Array.isArray(p) ? p : [])).catch(() => setPend([]));
  }, [refreshKey, bump]);
  async function act(id: string, what: "confirm" | "skip", label: string) {
    try {
      if (what === "confirm") await api(`/transactions/${id}/confirm`, { method: "POST", json: {} }); else await api(`/transactions/${id}`, { method: "DELETE" });
      toast(what === "confirm" ? `Confirmed ${label}` : `Skipped ${label} this month`, what === "skip" ? async () => { await api(`/transactions/${id}?undo=1`, { method: "DELETE" }); setBump((b) => b + 1); } : undefined);
      setBump((b) => b + 1); dispatchEvent(new Event("lists-changed"));
    } catch (e) { toast((e as Error).message); }
  }
  const initial = me.initial ?? "D";
  const mine = m?.accounts.find((a) => a.type === "checking" && lists.accounts.find((x) => x.id === a.id)?.owner === initial) ?? null;
  const funName = initial === "E" ? "elizabeth fun" : "david fun";
  const funId = Object.entries(m?.categories ?? {}).find(([, c]) => c.name.toLowerCase().includes(funName))?.[0] ?? null;
  const fun = funId ? m?.view.categories.find((c) => c.categoryId === funId) ?? null : null;
  const today = new Date();
  const hour = today.getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const cats = m?.view.categories.filter((c) => !m.categories[c.categoryId]?.hidden) ?? [];
  const overspent = cats.filter((c) => c.status === "overspent").sort((a, b) => a.available - b.available);
  const under = cats.filter((c) => c.status === "underfunded" || c.status === "not_enough").sort((a, b) => b.short - a.short);
  const catName = (id: string | null) => (id ? `${m?.categories[id]?.emoji ?? ""} ${m?.categories[id]?.name ?? ""}`.trim() : "Ready to Assign");
  const acctName = (id: string) => lists.accounts.find((a) => a.id === id)?.name ?? "";
  const card = "rounded-xl p-3.5 flex flex-col gap-2";
  const cs = { background: "var(--card)", border: "1px solid var(--border)" } as const;
  const week = fun ? weeklyAllowance(fun.available, todayISO()) : null;

  return (
    <div className="flex flex-col gap-3 -mx-4 md:mx-0">
      <div className="px-5 pb-4 flex flex-col gap-3 md:rounded-xl" style={{ background: "var(--rail)", color: "#fff", paddingTop: "calc(1rem + env(safe-area-inset-top))" }}>
        <div>
          <div className="text-[13px] opacity-75">{DAYS[today.getDay()]}, {MON[today.getMonth()]} {today.getDate()}</div>
          <div className="text-[22px] font-bold">{greet}, {me.name.split(" ")[0]}</div>
        </div>
        {mine && (
          <button onClick={() => goTransactions(mine.id)} className="flex items-center justify-between rounded-xl px-3.5 py-3 text-left" style={{ background: "rgba(255,255,255,0.12)" }}>
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold uppercase tracking-wider opacity-75">{mine.name}</span>
              <span className="text-[28px] font-bold leading-tight">{formatMoney(mine.balance)}</span>
            </div>
            <span className="text-xs opacity-85">Open ledger ›</span>
          </button>
        )}
      </div>

      <div className="px-3 flex flex-col gap-3 md:px-0">
        {pend.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ ...cs, borderColor: "var(--yellow)" }}>
            <div className="flex justify-between items-center px-3.5 py-2.5" style={{ background: "var(--yellow-row)", borderBottom: "1px solid var(--border-soft)" }}>
              <span className="text-sm font-bold">To confirm</span><span className="text-xs" style={{ color: "var(--yellow-text)" }}>{pend.length} recurring {pend.length === 1 ? "bill" : "bills"} landed</span>
            </div>
            {pend.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-3.5 py-2" style={{ borderBottom: "1px solid var(--border-soft)" }}>
                <span className="flex flex-col min-w-0 flex-1"><span className="text-sm font-medium truncate">{p.payee ?? "—"}</span><span className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{MON[Number(p.date.slice(5, 7)) - 1]} {Number(p.date.slice(8, 10))} · {catName(p.categoryId)} · {acctName(p.accountId)}</span></span>
                <span className="text-sm font-semibold shrink-0" style={{ color: p.amount < 0 ? "var(--neg)" : "var(--green-text)" }}>{formatMoney(p.amount)}</span>
                <button onClick={() => act(p.id, "confirm", p.payee ?? "entry")} className="rounded-full px-2.5 h-7 text-[12px] font-semibold shrink-0" style={{ background: "var(--green-solid)", color: "#fff" }}>Confirm</button>
                {openEdit && <button onClick={() => openEdit(p.id)} className="rounded-full px-2.5 h-7 text-[12px] font-semibold shrink-0" style={{ border: "1px solid var(--field)" }}>Adjust</button>}
                <button onClick={() => act(p.id, "skip", p.payee ?? "entry")} className="rounded-full px-2 h-7 text-[12px] font-semibold shrink-0" style={{ color: "var(--muted)" }}>Skip</button>
              </div>
            ))}
          </div>
        )}
        {fun && (
          <button onClick={() => goTransactions(null)} className="block w-full text-left rounded-xl" style={{ ...cs, padding: "12px 14px" }}>
            {/* layout lives in a div: iOS Safari won't lay out a <button> itself as a flex column */}
            <div className="flex flex-col" style={{ gap: 8 }}>
              <div className="flex justify-between items-baseline gap-3"><span className="text-sm font-bold truncate">{catName(fun.categoryId)}</span><span className="text-xl font-bold shrink-0" style={{ color: fun.available < 0 ? "var(--red-text)" : "var(--green-text)" }}>{formatMoney(fun.available)}</span></div>
              <div className="rounded-full overflow-hidden flex w-full" style={{ height: 6, background: "var(--track)" }}>
                <div className="h-full stripes" style={{ width: `${fun.goal ? Math.min(100, (Math.max(0, -fun.activity) / fun.goal.amount) * 100) : 0}%` }} />
                <div className="h-full" style={{ width: `${fun.goal ? Math.max(0, Math.min(100, (fun.available / fun.goal.amount) * 100)) : 0}%`, background: fun.available < 0 ? "var(--red)" : "var(--green)" }} />
              </div>
              <div className="flex justify-between items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
                <span className="truncate">Spent {formatMoney(-fun.activity)}{fun.goal ? ` of ${formatMoney(fun.goal.amount)}` : ""}</span>
                {week && <span className="font-bold rounded-full shrink-0" style={{ background: "var(--selected)", color: "var(--accent-text)", padding: "3px 9px" }}>{formatMoney(week.perWeek)} / week · {week.weeksLeft} wks left</span>}
              </div>
            </div>
          </button>
        )}

        {m && (
          <a href="#budget" className={card} style={cs}>
            <div className="flex justify-between items-baseline"><span className="text-sm font-bold">Budget check</span><span className="text-xs" style={{ color: "var(--muted)" }}>{overspent.length + under.length} of {cats.length} need attention ›</span></div>
            {[{ items: overspent, label: "Overspent", bg: "var(--red-bg)", fg: "var(--red-text)", val: (c: typeof cats[number]) => c.available }, { items: under, label: "Underfunded", bg: "var(--yellow-bg)", fg: "var(--yellow-text)", val: (c: typeof cats[number]) => c.short }].map((s) => (
              <div key={s.label} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-[13px] font-semibold"><span>{s.label}</span><span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold" style={{ background: s.bg, color: s.fg }}>{s.items.length}</span></div>
                {s.items.slice(0, 3).map((c) => <div key={c.categoryId} className="flex justify-between text-xs pl-2"><span style={{ color: "var(--text-2)" }}>{catName(c.categoryId)}</span><span className="font-semibold" style={{ color: s.fg }}>{formatMoney(s.val(c))}</span></div>)}
                {s.items.length > 3 && <span className="text-xs pl-2" style={{ color: "var(--muted)" }}>+ {s.items.length - 3} more</span>}
              </div>
            ))}
            <div className="flex justify-between text-xs" style={{ color: "var(--muted)" }}><span>Ready to Assign <strong style={{ color: m.view.readyToAssign === 0 ? "var(--green-text)" : "var(--yellow-text)" }}>{formatMoney(m.view.readyToAssign)}</strong></span><span>{cats.filter((c) => c.goal && c.status === "funded").length} funded ✓</span></div>
          </a>
        )}

        <div className="rounded-xl overflow-hidden" style={cs}>
          <div className="flex justify-between items-center px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--border-soft)" }}>
            <span className="text-sm font-bold">Recent · all accounts</span>
            <button onClick={() => goTransactions(null)} className="text-xs font-semibold" style={{ color: "var(--accent-text)" }}>See all ›</button>
          </div>
          {recent === null && <div className="px-3.5 py-3 text-xs" style={{ color: "var(--muted)" }}>Loading…</div>}
          {recent?.map((r) => (
            <div key={r.id} className="grid items-center px-3.5 py-2" style={{ gridTemplateColumns: "1fr 84px", borderBottom: "1px solid var(--border-soft)" }}>
              <span className="flex flex-col min-w-0"><span className="text-sm font-medium truncate">{r.payee ?? (r.transferToAccountId ? "Transfer" : "—")}</span><span className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{MON[Number(r.date.slice(5, 7)) - 1]} {Number(r.date.slice(8, 10))} · {r.lines.length > 1 ? "Split" : r.transferToAccountId ? "Transfer" : catName(r.lines[0]?.categoryId ?? null)} · {acctName(r.accountId)}</span></span>
              <span className="text-right text-sm font-semibold" style={{ color: r.amount === null ? "var(--faint)" : r.amount < 0 ? "var(--neg)" : "var(--green-text)" }}>{r.amount === null ? "—" : formatMoney(r.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { formatMoney } from "../budget/money";
import { addMonths } from "../budget/dates";
import type { MonthPayload } from "../server/month";
import { Chevron } from "./icons";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

const chipStyle: Record<string, { bg: string; fg: string }> = {
  funded: { bg: "var(--green-bg)", fg: "var(--green-text)" },
  none: { bg: "var(--green-bg)", fg: "var(--green-text)" },
  covered: { bg: "var(--green-bg)", fg: "var(--green-text)" },
  underfunded: { bg: "var(--yellow-bg)", fg: "var(--yellow-text)" },
  not_enough: { bg: "var(--yellow-bg)", fg: "var(--yellow-text)" },
  overspent: { bg: "var(--red-bg)", fg: "var(--red-text)" },
};

export function Budget({ showBars }: { showBars: boolean }) {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<MonthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setError(null);
    fetch(month ? `/api/month/${month}` : "/api/month")
      .then(async (r) => (r.ok ? setData((await r.json()) as MonthPayload) : setError((await r.json()).error ?? r.statusText)))
      .catch((e) => setError(String(e)));
  }, [month]);

  if (error) return <p className="text-sm" style={{ color: "var(--red-text)" }}>{error}</p>;
  if (!data) return <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!data.groups.length)
    return (
      <div className="rounded-xl p-6 text-sm" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        Nothing here yet — import the spreadsheet export under <a href="#settings" style={{ color: "var(--accent-text)", fontWeight: 600 }}>Settings</a>.
      </div>
    );

  const { view } = data;
  const byId = new Map(view.categories.map((c) => [c.categoryId, c]));
  const rta = view.readyToAssign;
  const rtaColor = rta === 0 ? { bg: "var(--green-solid)", fg: "#fff", glow: "0 0 0 3px rgba(47,191,98,0.18), 0 4px 14px rgba(47,191,98,0.35)" } : rta > 0 ? { bg: "var(--yellow-bg)", fg: "var(--yellow-text)", glow: "none" } : { bg: "var(--red-bg)", fg: "var(--red-text)", glow: "none" };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button aria-label="Previous month" onClick={() => setMonth(addMonths(data.month, -1))} className="w-9 h-9 rounded-full inline-flex items-center justify-center" style={{ border: "1px solid var(--field)", background: "var(--card)", color: "var(--muted)" }}><Chevron dir="left" /></button>
          <h1 className="text-xl font-bold">{label(data.month)}</h1>
          <button aria-label="Next month" onClick={() => setMonth(addMonths(data.month, 1))} className="w-9 h-9 rounded-full inline-flex items-center justify-center" style={{ border: "1px solid var(--field)", background: "var(--card)", color: "var(--muted)" }}><Chevron dir="right" /></button>
        </div>
        <div className="flex items-center gap-3 rounded-xl px-4 py-2" style={{ background: rtaColor.bg, color: rtaColor.fg, boxShadow: rtaColor.glow }}>
          <span className="text-xs font-semibold uppercase tracking-wider">Ready to Assign</span>
          <span className="text-2xl font-bold">{formatMoney(rta)}</span>
        </div>
      </div>

      {data.check && (
        <div className="rounded-xl p-3 text-sm" style={{ background: data.check.ok ? "var(--green-bg)" : "var(--red-bg)", color: data.check.ok ? "var(--green-text)" : "var(--red-text)" }}>
          {data.check.ok ? (
            <>✓ Matches the spreadsheet to the cent — Ready to Assign, every category, every account (export imported {data.check.source?.slice(0, 16).replace("T", " ")}).</>
          ) : (
            <>
              <div className="font-semibold">Differs from the spreadsheet:</div>
              <ul className="list-disc ml-5">{data.check.diffs.map((d) => <li key={d}>{d}</li>)}</ul>
            </>
          )}
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="grid text-[11px] font-semibold uppercase tracking-wider px-4 py-2" style={{ gridTemplateColumns: "minmax(0,1fr) 110px 110px 130px", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
          <span>Category</span><span className="text-right hidden md:block">Assigned</span><span className="text-right hidden md:block">Activity</span><span className="text-right">Available</span>
        </div>
        {data.groups.map((g) => {
          const rows = g.categories.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c && !data.categories[c.categoryId]?.hidden);
          const tot = (k: "assigned" | "activity" | "available") => rows.reduce((s, c) => s + c[k], 0);
          const open = !collapsed.has(g.id);
          return (
            <div key={g.id}>
              <button
                onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })}
                className="w-full grid text-left text-[13px] font-semibold px-4 py-2"
                style={{ gridTemplateColumns: "minmax(0,1fr) 110px 110px 130px", background: "var(--group)", color: "var(--text-2)", borderTop: "1px solid var(--border)" }}
              >
                <span className="inline-flex items-center gap-1.5"><Chevron dir={open ? "down" : "right"} size={12} /> {g.name}</span>
                <span className="text-right hidden md:block">{formatMoney(tot("assigned"))}</span>
                <span className="text-right hidden md:block">{formatMoney(tot("activity"))}</span>
                <span className="text-right">{formatMoney(tot("available"))}</span>
              </button>
              {open && rows.map((c) => {
                const meta = data.categories[c.categoryId]!;
                const chip = chipStyle[c.status] ?? chipStyle.none!;
                const goal = c.goal;
                const statusText =
                  c.status === "overspent" ? `Overspent by ${formatMoney(-c.available)}`
                  : c.status === "underfunded" || c.status === "not_enough" ? `Underfunded by ${formatMoney(c.short)}`
                  : goal && c.activity < 0 ? (c.available === 0 ? "Fully spent" : `Spent ${formatMoney(-c.activity)} of ${formatMoney(goal.amount)}`)
                  : goal ? "Funded" : "";
                const spent = goal && goal.amount > 0 ? Math.min(1, Math.max(0, -c.activity) / goal.amount) : 0;
                const funded = goal && goal.amount > 0 ? Math.min(1, Math.max(0, (c.available + Math.max(0, -c.activity)) / goal.amount)) : c.available > 0 ? 1 : 0;
                return (
                  <div key={c.categoryId} className="grid items-center px-4 py-2 text-sm" style={{ gridTemplateColumns: "minmax(0,1fr) 110px 110px 130px", borderTop: "1px solid var(--border-soft)", background: c.status === "underfunded" ? "var(--yellow-row)" : undefined }}>
                    <div className="min-w-0 flex flex-col gap-1.5">
                      <div className="flex items-baseline gap-2 whitespace-nowrap min-w-0">
                        <span className="font-medium shrink-0">{meta.emoji ? `${meta.emoji} ` : ""}{meta.name}</span>
                        <span className="text-xs overflow-hidden text-ellipsis" style={{ color: c.status === "overspent" ? "var(--red-text)" : "var(--muted)" }}>{statusText}</span>
                      </div>
                      {showBars && goal && (
                        <div className="h-1.5 rounded-full overflow-hidden flex w-full" style={{ background: "var(--track)" }}>
                          <div className="h-full stripes" style={{ width: `${spent * 100}%` }} />
                          <div className="h-full" style={{ width: `${Math.max(0, funded - spent) * 100}%`, background: c.status === "overspent" ? "var(--red)" : c.status === "underfunded" || c.status === "not_enough" ? "var(--yellow)" : "var(--green)" }} />
                        </div>
                      )}
                    </div>
                    <span className="text-right hidden md:block">{formatMoney(c.assigned)}</span>
                    <span className="text-right hidden md:block" style={{ color: "var(--muted)" }}>{formatMoney(c.activity)}</span>
                    <span className="text-right">
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold" style={{ background: chip.bg, color: chip.fg }}>
                        {c.status === "funded" && <span className="inline-flex w-4 h-4 rounded-full items-center justify-center text-white" style={{ background: "var(--green)" }}>✓</span>}
                        {(c.status === "underfunded" || c.status === "not_enough") && <span className="inline-block w-4 h-4 rounded-full" style={{ border: "2px solid var(--yellow)", background: "linear-gradient(90deg, var(--yellow) 50%, transparent 50%)" }} />}
                        {formatMoney(c.available)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-3 text-sm">
        <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Cash on budget</div>
          <div className="text-xl font-bold">{formatMoney(view.cashOnBudget)}</div>
          <div style={{ color: "var(--muted)" }}>Days of buffer: {Number.isFinite(data.daysOfBuffer) ? data.daysOfBuffer : "∞"}</div>
        </div>
        <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Cards</div>
          <div>Owed {formatMoney(view.owedOnCards)} · Set aside {formatMoney(view.setAsideForCards)}</div>
          <div style={{ color: view.uncoveredCardDebt > 0 ? "var(--red-text)" : "var(--muted)" }}>Uncovered {formatMoney(view.uncoveredCardDebt)}</div>
        </div>
        <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Zero check</div>
          <div className="text-xl font-bold" style={{ color: view.zeroCheck === 0 ? "var(--green-text)" : "var(--red-text)" }}>{view.zeroCheck === 0 ? "✓ $0.00" : formatMoney(view.zeroCheck)}</div>
          <div style={{ color: "var(--muted)" }}>cash − (available + ready to assign)</div>
        </div>
      </div>
    </div>
  );
}

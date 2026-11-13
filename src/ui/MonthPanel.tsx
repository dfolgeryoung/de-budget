import type React from "react";
import { formatMoney } from "../budget/money";
import type { MonthPayload } from "../server/month";
import { monthLabel } from "./Budget";

/** What the side panel shows when no category is picked: the sheet's month summary and budget details. */
export function MonthPanel({ data, onPick, onRelease }: { data: MonthPayload; onPick: (id: string) => void; onRelease?: (categoryId: string, amount: number) => void }) {
  const v = data.view;
  // Next Month's Money: what was set aside last month, ready to be released into this month's Ready to Assign
  const nmm = v.categories.find((c) => data.categories[c.categoryId]?.kind === "next_month" && c.available > 0 && c.carriedIn > 0);
  const cats = v.categories.filter((c) => !data.categories[c.categoryId]?.hidden);
  const sum = (k: "carriedIn" | "assigned" | "activity" | "available") => cats.reduce((s, c) => s + c[k], 0);
  const overspent = cats.filter((c) => c.status === "overspent").sort((a, b) => a.available - b.available);
  const under = cats.filter((c) => c.status === "underfunded" || c.status === "not_enough").sort((a, b) => b.short - a.short);
  const funded = cats.filter((c) => c.goal && c.status === "funded").length;
  const bills = data.billsToCome;
  const acctName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const name = (id: string) => `${data.categories[id]?.emoji ?? ""} ${data.categories[id]?.name ?? ""}`.trim();
  const row = (l: string, val: string, strong = false, color?: string) => (
    <div className="flex justify-between text-[13px]" style={strong ? { fontWeight: 700 } : undefined}><span style={{ color: strong ? undefined : "var(--muted)" }}>{l}</span><span style={{ color }}>{val}</span></div>
  );
  const Box = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider px-4 py-2" style={{ color: "var(--text-2)", background: "var(--group)", borderBottom: "1px solid var(--border)" }}>{title}</h2>
      <div className="flex flex-col gap-2 p-4">{children}</div>
    </section>
  );
  const ord = (d: number) => `${d}${["th", "st", "nd", "rd"][d % 10 > 3 || Math.floor((d % 100) / 10) === 1 ? 0 : d % 10]}`;
  const list = (items: typeof cats, val: (c: typeof cats[number]) => number, bg: string, fg: string, label: string) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <span>{label}</span>
        <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold" style={{ background: bg, color: fg }}>{items.length}</span>
      </div>
      {items.length === 0 && <span className="text-xs" style={{ color: "var(--muted)" }}>None</span>}
      {items.slice(0, 4).map((c) => <button key={c.categoryId} onClick={() => onPick(c.categoryId)} className="flex justify-between text-[13px] text-left pl-2"><span className="truncate" style={{ color: "var(--text-2)" }}>{name(c.categoryId)}</span><span className="font-semibold ml-2" style={{ color: fg }}>{formatMoney(val(c))}</span></button>)}
      {items.length > 4 && <span className="text-xs pl-2" style={{ color: "var(--muted)" }}>+ {items.length - 4} more</span>}
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <Box title={`Month summary · ${monthLabel(data.month)}`}>
        {row("Left over from last month", formatMoney(sum("carriedIn")))}
        {row("Assigned this month", formatMoney(sum("assigned")))}
        {row("Activity", formatMoney(sum("activity")))}
        {row("Available", formatMoney(sum("available")), true)}
        {v.readyToAssign === 0 ? row("Ready to Assign", "All money assigned", true, "var(--muted)") : row("Ready to Assign", formatMoney(v.readyToAssign), true, v.readyToAssign > 0 ? "var(--yellow-text)" : "var(--red-text)")}
        {nmm && onRelease && (
          <button onClick={() => onRelease(nmm.categoryId, Math.min(nmm.available, nmm.carriedIn))} className="mt-2 rounded-lg px-3 py-2 text-[13px] font-semibold text-left" style={{ background: "var(--selected)", color: "var(--accent-text)", border: "1px solid var(--navy)" }}>
            Release {formatMoney(Math.min(nmm.available, nmm.carriedIn))} from {data.categories[nmm.categoryId]?.name} into Ready to Assign ›
          </button>
        )}
      </Box>
      <Box title="Budget check">
        {list(overspent, (c) => c.available, "var(--red-bg)", "var(--red-text)", "Overspent")}
        {list(under, (c) => c.short, "var(--yellow-bg)", "var(--yellow-text)", "Underfunded")}
        <div className="pt-2 flex flex-col gap-1" style={{ borderTop: "1px solid var(--border-soft)" }}>
          {row("Funded", `${funded} ✓`)}
          {row("Total underfunded", formatMoney(under.reduce((s, c) => s + c.short, 0)))}
        </div>
      </Box>
      <Box title="Bills still to come">
        {bills.length === 0 && <span className="text-[13px]" style={{ color: "var(--muted)" }}>All recurring bills are in.</span>}
        {bills.slice(0, 8).map((b) => (
          <div key={b.id} className="grid items-center gap-2 text-[13px]" style={{ gridTemplateColumns: "34px minmax(0,1fr) auto" }}>
            <span className="tabular-nums" style={{ color: "var(--muted)" }}>{b.day ? ord(b.day) : "—"}</span>
            <span className="min-w-0 truncate" style={{ color: "var(--text-2)" }}>{b.payee}<span style={{ color: "var(--faint)" }}> · {acctName.get(b.accountId) ?? ""}</span></span>
            <span className="font-semibold tabular-nums">{formatMoney(-b.amount)}</span>
          </div>
        ))}
        {bills.length > 0 && <div className="pt-1" style={{ borderTop: "1px solid var(--border-soft)" }}>{row("Total", formatMoney(-bills.reduce((s, b) => s + b.amount, 0)), true)}</div>}
      </Box>
      <Box title="Cards">
        {row("Owed on cards", formatMoney(v.owedOnCards))}
        {row("Set aside", formatMoney(v.setAsideForCards))}
        {row("Uncovered", formatMoney(v.uncoveredCardDebt), false, v.uncoveredCardDebt > 0 ? "var(--red-text)" : undefined)}
      </Box>
    </div>
  );
}

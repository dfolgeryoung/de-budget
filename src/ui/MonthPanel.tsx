import { formatMoney } from "../budget/money";
import type { MonthPayload } from "../server/month";
import { monthLabel } from "./Budget";

/** What the side panel shows when no category is picked: the sheet's month summary and budget details. */
export function MonthPanel({ data, onPick }: { data: MonthPayload; onPick: (id: string) => void }) {
  const v = data.view;
  const cats = v.categories.filter((c) => !data.categories[c.categoryId]?.hidden);
  const sum = (k: "carriedIn" | "assigned" | "activity" | "available") => cats.reduce((s, c) => s + c[k], 0);
  const overspent = cats.filter((c) => c.status === "overspent").sort((a, b) => a.available - b.available);
  const under = cats.filter((c) => c.status === "underfunded" || c.status === "not_enough").sort((a, b) => b.short - a.short);
  const funded = cats.filter((c) => c.goal && c.status === "funded").length;
  const bills = data.billsToCome;
  const name = (id: string) => `${data.categories[id]?.emoji ?? ""} ${data.categories[id]?.name ?? ""}`.trim();
  const row = (l: string, val: string, strong = false, color?: string) => (
    <div className="flex justify-between text-[13px]" style={strong ? { fontWeight: 700 } : undefined}><span style={{ color: strong ? undefined : "var(--muted)" }}>{l}</span><span style={{ color }}>{val}</span></div>
  );
  const head = (t: string) => <div className="text-[11px] font-semibold uppercase tracking-wider pt-1" style={{ color: "var(--muted)" }}>{t}</div>;
  return (
    <div className="rounded-xl flex flex-col gap-3 p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="text-[17px] font-bold">{monthLabel(data.month)}</div>
      {head("Month summary")}
      {row("Left over from last month", formatMoney(sum("carriedIn")))}
      {row("Assigned this month", formatMoney(sum("assigned")))}
      {row("Activity", formatMoney(sum("activity")))}
      {row("Available", formatMoney(sum("available")), true)}
      {row("Ready to Assign", formatMoney(v.readyToAssign), true, v.readyToAssign === 0 ? "var(--green-text)" : v.readyToAssign > 0 ? "var(--yellow-text)" : "var(--red-text)")}

      {head("Budget check")}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg p-2.5 flex flex-col gap-1" style={{ background: "var(--red-bg)", color: "var(--red-text)" }}>
          <span className="flex items-baseline gap-1.5"><span className="text-lg font-bold">{overspent.length}</span><span className="text-[11px] font-bold">overspent</span></span>
          {overspent.slice(0, 3).map((c) => <button key={c.categoryId} onClick={() => onPick(c.categoryId)} className="flex justify-between text-[11px] text-left"><span className="truncate">{name(c.categoryId)}</span><span className="font-semibold ml-1.5">{formatMoney(c.available)}</span></button>)}
          {overspent.length > 3 && <span className="text-[11px]">+ {overspent.length - 3} more</span>}
        </div>
        <div className="rounded-lg p-2.5 flex flex-col gap-1" style={{ background: "var(--yellow-bg)", color: "var(--yellow-text)" }}>
          <span className="flex items-baseline gap-1.5"><span className="text-lg font-bold">{under.length}</span><span className="text-[11px] font-bold">underfunded</span></span>
          {under.slice(0, 3).map((c) => <button key={c.categoryId} onClick={() => onPick(c.categoryId)} className="flex justify-between text-[11px] text-left"><span className="truncate">{name(c.categoryId)}</span><span className="font-semibold ml-1.5">{formatMoney(c.short)}</span></button>)}
          {under.length > 3 && <span className="text-[11px]">+ {under.length - 3} more</span>}
        </div>
      </div>
      {row("Funded", `${funded} ✓`)}
      {row("Total underfunded", formatMoney(under.reduce((s, c) => s + c.short, 0)))}

      {head("Bills still to come")}
      {bills.length === 0 && <span className="text-[13px]" style={{ color: "var(--muted)" }}>All recurring bills are in.</span>}
      {bills.slice(0, 8).map((b) => (
        <div key={b.id} className="flex justify-between text-[13px]"><span style={{ color: "var(--text-2)" }}>{b.day ? `${b.day}th · ` : ""}{b.payee}</span><span className="font-semibold">{formatMoney(-b.amount)}</span></div>
      ))}
      {bills.length > 0 && row("Total", formatMoney(-bills.reduce((s, b) => s + b.amount, 0)), true)}

      {head("Cards")}
      {row("Owed on cards", formatMoney(v.owedOnCards))}
      {row("Set aside", formatMoney(v.setAsideForCards))}
      {row("Uncovered", formatMoney(v.uncoveredCardDebt), false, v.uncoveredCardDebt > 0 ? "var(--red-text)" : undefined)}
    </div>
  );
}

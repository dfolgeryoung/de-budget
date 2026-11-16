/**
 * Plain-language sentences about the month, shared by the Monday email and the desktop Home. Pure functions over
 * the report and month figures, so the two always say the same thing.
 */
import { formatMoney } from "./money.js";
import type { ReportsView } from "./reports.js";
import type { MonthView } from "./engine.js";

const money = (c: number) => formatMoney(c);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1]!;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Spending: pace, comparison with last month, who spent, and what's heading over. `greet` adds the email's "Hi name —" opener. */
export function narrative(r: ReportsView, people: { D: string; E: string }, greet: string | null): string[] {
  const tm = r.thisMonth, out: string[] = [];
  const diff = tm.onPace - tm.budgeted, dayWord = `day ${r.daysElapsed} of ${r.daysInMonth}`;
  const lead = greet ? `Hi ${greet} — it's ${dayWord} of ${monthName(r.month)}. So far you've` : `It's ${dayWord} of ${monthName(r.month)}, and so far you've`;
  out.push(`${lead} spent ${money(tm.spent)} of the ${money(tm.budgeted)} budgeted, which is ${pct(tm.spent, tm.budgeted)}% of the budget with ${Math.round((r.daysElapsed / r.daysInMonth) * 100)}% of the month gone.`);
  if (r.daysElapsed > 0) {
    out.push(diff > 0
      ? `At this pace the month lands at ${money(tm.onPace)} — about ${money(diff)} over budget — so it's worth easing off somewhere, or moving money to cover it.`
      : `At this pace the month lands at ${money(tm.onPace)}, about ${money(-diff)} under budget. Nice.`);
  }
  if (tm.vsLast.pct !== null && tm.vsLast.prevSpent > 0) {
    const p = Math.round(Math.abs(tm.vsLast.pct) * 100);
    out.push(tm.vsLast.pct > 0.03 ? `That's ${p}% more than the same point in ${monthName(r.prevMonth)} — ${tm.vsLast.summary.toLowerCase()}.`
      : tm.vsLast.pct < -0.03 ? `That's ${p}% less than the same point in ${monthName(r.prevMonth)} — ${tm.vsLast.summary.toLowerCase()}.`
      : `That's almost exactly where you were at this point in ${monthName(r.prevMonth)}.`);
  }
  const shared = tm.byOwner.find((o) => o.who === "shared"), d = tm.byOwner.find((o) => o.who === "D"), e = tm.byOwner.find((o) => o.who === "E");
  if (shared && d && e && shared.spent + d.spent + e.spent > 0) {
    out.push(`${Math.round(shared.share * 100)}% of it was shared household spending${shared.parts?.[0] ? ` (${shared.parts[0].name} is the biggest piece)` : ""}; ${people.D} spent ${money(d.spent)} and ${people.E} ${money(e.spent)} on their own lines.`);
  }
  if (r.projection.headingOver.length) {
    const top = r.projection.headingOver.slice(0, 3).map((c) => `${c.name} (by ${money(c.over)})`).join(", ");
    out.push(`Heading over if nothing changes: ${top}${r.projection.headingOver.length > 3 ? ` and ${r.projection.headingOver.length - 3} more` : ""}.`);
  }
  return out;
}

export interface SavingFacts {
  income: number; // income that landed this month so far
  spent: number; // spending this month so far
  nextMonth: { available: number; needed: number } | null; // the "next month's money" category
  readyToAssign: number;
  daysOfBuffer: number;
  lastMonths: { month: string; income: number; spent: number }[]; // earlier months, oldest first
}

export function savingFacts(r: ReportsView, view: MonthView, kinds: Record<string, string>, daysOfBuffer: number): SavingFacts {
  const cur = r.trends.months.find((m) => m.month === r.month);
  const nmId = Object.entries(kinds).find(([, k]) => k === "next_month")?.[0];
  const nm = nmId ? view.categories.find((c) => c.categoryId === nmId) : undefined;
  return {
    income: cur?.income ?? 0, spent: cur?.spent ?? r.thisMonth.spent,
    nextMonth: nm ? { available: nm.available, needed: nm.needed } : null,
    readyToAssign: view.readyToAssign, daysOfBuffer,
    lastMonths: r.trends.months.filter((m) => m.month < r.month).map((m) => ({ month: m.month, income: m.income, spent: m.spent })),
  };
}

/** Saving: income against spending, next month's money, and the cushion. */
export function savingNarrative(f: SavingFacts): string[] {
  const out: string[] = [];
  const net = f.income - f.spent;
  if (f.income > 0) out.push(net >= 0
    ? `${money(f.income)} of income has landed this month against ${money(f.spent)} spent, so ${money(net)} of it is still in hand.`
    : `${money(f.income)} of income has landed this month, but spending is already ${money(f.spent)} — ${money(-net)} more than came in.`);
  else out.push(`No income has landed yet this month; spending so far is ${money(f.spent)}.`);
  if (f.nextMonth) {
    const { available, needed } = f.nextMonth;
    out.push(needed > 0
      ? available >= needed ? `Next month's money is fully set aside (${money(available)}).` : `Next month's money has ${money(available)} of the ${money(needed)} it needs — ${money(needed - available)} to go.`
      : `Next month's money has ${money(available)} set aside.`);
  }
  if (f.readyToAssign > 0) out.push(`${money(f.readyToAssign)} is sitting unassigned and could go to a goal.`);
  else if (f.readyToAssign < 0) out.push(`You've assigned ${money(-f.readyToAssign)} more than you have — the budget needs trimming.`);
  if (Number.isFinite(f.daysOfBuffer)) out.push(`The money on budget covers about ${f.daysOfBuffer} days of normal spending.`);
  const recent = f.lastMonths.slice(-3).filter((m) => m.income > 0);
  if (recent.length) {
    const kept = recent.map((m) => m.income - m.spent);
    const avg = Math.round(kept.reduce((s, x) => s + x, 0) / kept.length);
    out.push(avg >= 0 ? `Over the last ${recent.length === 1 ? "month" : `${recent.length} months`} you kept an average of ${money(avg)} a month after spending.` : `Over the last ${recent.length === 1 ? "month" : `${recent.length} months`} spending outran income by an average of ${money(-avg)} a month.`);
  }
  return out;
}

/**
 * Savings, month by month, in the Classic view's terms so the two agree:
 *   put away  = income − spending (spending leaves out contributions)
 *   leftover  = put away − contributions         (Classic's "savings so far")
 * Contributions are the retirement and 529 lines — money that is spent from the budget's point of view but saved from
 * yours. Income is what actually landed (Ready to Assign inflows on on-budget accounts), not the typed Classic figure.
 */
import { type BudgetInput, incomeToRTA } from "./engine.js";
import { spendByCategory } from "./reports.js";
import { addMonths, daysInMonth, type MonthKey, type ISODate } from "./dates.js";
import type { Cents } from "./money.js";

export const CONTRIBUTION_RE = /retirement|529|\b401|\bira\b|pension|hsa\b/i;
export const isContribution = (name: string) => CONTRIBUTION_RE.test(name);

export interface SavingsMonth {
  month: MonthKey;
  partial: boolean; // the current month, so far
  daysElapsed: number; daysInMonth: number;
  income: Cents;
  spending: Cents; // without contributions
  contributions: Cents;
  putAway: Cents; // income − spending
  leftover: Cents; // putAway − contributions
  running: Cents; // cumulative put away
  contributionLines: { id: string; name: string; amount: Cents }[];
}

export interface SavingsView { months: SavingsMonth[]; totals: { income: Cents; spending: Cents; contributions: Cents; putAway: Cents }; avgPutAway: Cents }

export function computeSavings(input: BudgetInput, categories: { id: string; name: string }[], today: ISODate): SavingsView {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const contribIds = new Set(categories.filter((c) => isContribution(c.name)).map((c) => c.id));
  const cur = today.slice(0, 7) + "-01";
  const months: SavingsMonth[] = [];
  let running = 0;
  for (let m = input.firstMonth; m <= cur; m = addMonths(m, 1)) {
    const partial = m === cur;
    const by = spendByCategory(input, m, partial ? today : null);
    let spending = 0, contributions = 0; const lines: SavingsMonth["contributionLines"] = [];
    for (const [id, v] of by) {
      if (contribIds.has(id)) { contributions += v; if (v) lines.push({ id, name: names.get(id) ?? id, amount: v }); } else spending += v;
    }
    const income = incomeToRTA(input, m, partial ? today : null);
    const putAway = income - spending;
    running += putAway;
    months.push({ month: m, partial, daysElapsed: partial ? Number(today.slice(8, 10)) : daysInMonth(m), daysInMonth: daysInMonth(m), income, spending, contributions, putAway, leftover: putAway - contributions, running, contributionLines: lines.sort((a, b) => b.amount - a.amount) });
  }
  const full = months.filter((x) => !x.partial);
  const totals = months.reduce((t, x) => ({ income: t.income + x.income, spending: t.spending + x.spending, contributions: t.contributions + x.contributions, putAway: t.putAway + x.putAway }), { income: 0, spending: 0, contributions: 0, putAway: 0 });
  return { months, totals, avgPutAway: full.length ? Math.round(full.reduce((s, x) => s + x.putAway, 0) / full.length) : 0 };
}

/**
 * Where the month's money came from and where it went, for the Sankey on Reports › Trends:
 *   sources (income by payee, plus "from earlier months" if outflows beat income)
 *     → Income
 *       → each category group's spending, retirement & 529 contributions, and what was saved (left over)
 */
import type { BudgetInput } from "./engine.js";
import { isContribution } from "./savings.js";
import { monthOf, type ISODate, type MonthKey } from "./dates.js";
import type { Cents } from "./money.js";

export interface FlowNode { id: string; name: string; amount: Cents; kind: "source" | "carry" | "income" | "group" | "contrib" | "saved" }
export interface FlowLink { from: string; to: string; amount: Cents }
export interface Flows { month: MonthKey; income: Cents; spending: Cents; contributions: Cents; saved: Cents; shortfall: Cents; nodes: FlowNode[]; links: FlowLink[] }

/**
 * `who` narrows the picture to one person the Classic way: their own accounts in full, a shared account or a 50/50
 * entry half each. Income follows the same rule, so a paycheck into E Checking is Elizabeth's.
 */
export function computeFlows(input: BudgetInput, month: MonthKey, through: ISODate | null, cats: { id: string; name: string; groupId: string }[], groups: { id: string; name: string }[], who: "D" | "E" | null = null, maxSources = 6, maxGroups = 8): Flows {
  const onBudget = new Set(input.accounts.filter((a) => a.onBudget).map((a) => a.id));
  const owner = new Map(input.accounts.map((a) => [a.id, a.owner]));
  const weight = (t: { accountId: string; sharedFiftyFifty?: boolean }): number => {
    if (!who) return 1;
    if (t.sharedFiftyFifty) return 0.5;
    const o = owner.get(t.accountId);
    return o === who ? 1 : o === "shared" ? 0.5 : 0;
  };
  // income by payee
  const byPayee = new Map<string, Cents>();
  for (const t of input.transactions) {
    if (monthOf(t.date) !== month || t.confirmed === false || t.transferToAccountId || !onBudget.has(t.accountId) || (through && t.date > through)) continue;
    const w = weight(t); if (!w) continue;
    for (const l of t.lines) if (!l.categoryId && l.amount > 0) byPayee.set(t.payee?.trim() || "Other income", (byPayee.get(t.payee?.trim() || "Other income") ?? 0) + Math.round(l.amount * w));
  }
  const sources = [...byPayee].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  const keptSources = sources.slice(0, maxSources);
  const otherIncome = sources.slice(maxSources).reduce((s, x) => s + x.amount, 0);
  if (otherIncome > 0) keptSources.push({ name: "Other income", amount: otherIncome });
  const income = sources.reduce((s, x) => s + x.amount, 0);

  // spending by group, contributions apart
  const catInfo = new Map(cats.map((c) => [c.id, c]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const byGroup = new Map<string, Cents>();
  let contributions = 0;
  const kinds = new Map(input.categories.map((c) => [c.id, c.kind]));
  const byCat = new Map<string, Cents>();
  for (const t of input.transactions) {
    if (monthOf(t.date) !== month || t.confirmed === false || t.transferToAccountId || (through && t.date > through)) continue;
    const w = weight(t); if (!w) continue;
    for (const l of t.lines) {
      if (!l.categoryId) continue;
      const k = kinds.get(l.categoryId);
      if (k && k !== "normal" && k !== "next_month") continue;
      byCat.set(l.categoryId, (byCat.get(l.categoryId) ?? 0) - Math.round(l.amount * w));
    }
  }
  for (const [id, v] of byCat) {
    if (v <= 0) continue; // net refunds don't flow anywhere useful
    const c = catInfo.get(id); if (!c) continue;
    if (isContribution(c.name)) { contributions += v; continue; }
    byGroup.set(c.groupId, (byGroup.get(c.groupId) ?? 0) + v);
  }
  const groupRows = [...byGroup].map(([id, amount]) => ({ id, name: groupName.get(id) ?? "Other", amount })).sort((a, b) => b.amount - a.amount);
  const keptGroups = groupRows.slice(0, maxGroups);
  const otherSpend = groupRows.slice(maxGroups).reduce((s, x) => s + x.amount, 0);
  if (otherSpend > 0) keptGroups.push({ id: "other", name: "Other", amount: otherSpend });
  const spending = groupRows.reduce((s, x) => s + x.amount, 0);

  const net = income - spending - contributions;
  const saved = Math.max(0, net), shortfall = Math.max(0, -net);

  const nodes: FlowNode[] = [
    ...keptSources.map((s, i) => ({ id: `src-${i}`, name: s.name, amount: s.amount, kind: "source" as const })),
    ...(shortfall > 0 ? [{ id: "carry", name: "From earlier months", amount: shortfall, kind: "carry" as const }] : []),
    { id: "income", name: "Income", amount: income + shortfall, kind: "income" },
    ...keptGroups.map((g) => ({ id: `grp-${g.id}`, name: g.name, amount: g.amount, kind: "group" as const })),
    ...(contributions > 0 ? [{ id: "contrib", name: "Retirement & 529s", amount: contributions, kind: "contrib" as const }] : []),
    ...(saved > 0 ? [{ id: "saved", name: "Saved", amount: saved, kind: "saved" as const }] : []),
  ];
  const links: FlowLink[] = [
    ...keptSources.map((s, i) => ({ from: `src-${i}`, to: "income", amount: s.amount })),
    ...(shortfall > 0 ? [{ from: "carry", to: "income", amount: shortfall }] : []),
    ...keptGroups.map((g) => ({ from: "income", to: `grp-${g.id}`, amount: g.amount })),
    ...(contributions > 0 ? [{ from: "income", to: "contrib", amount: contributions }] : []),
    ...(saved > 0 ? [{ from: "income", to: "saved", amount: saved }] : []),
  ];
  return { month, income, spending, contributions, saved, shortfall, nodes, links };
}

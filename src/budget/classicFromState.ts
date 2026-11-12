/** Build the Classic input from a spreadsheet export + the computed month: what the importer stores and the server later reads. */
import { mapState, type SheetState } from "./fromState.js";
import { computeMonth, type MonthView } from "./engine.js";
import { cents as toCents } from "./fromState.js";
import type { ClassicInput, ClassicLineDef, ClassicRule } from "./classic.js";
import type { MonthKey, ISODate } from "./dates.js";

export const SPLIT_BUCKETS: Record<string, ClassicRule> = { "By account": "by_account", "Phone split": "phone_split", "Utilities split": "utilities_split", "Drive split": "drive_split" };

/** The layout with its typed flags: a line is typed when no category's bucket lands on it (Fun Money lands via "David/Elizabeth Fun Money"). */
export function layoutFromState(state: SheetState): ClassicLineDef[] {
  const c = state.classic!;
  const buckets = new Set(c.mapping.map(([, b]) => b));
  return c.layout.map((l) => ({ name: l.name, column: l.column, section: l.section, typed: !buckets.has(l.name) && l.name !== "Fun Money", defaultBudget: toCents(l.budget) }));
}

export function classicInputFromState(state: SheetState, month: MonthKey, today: ISODate, view?: MonthView): ClassicInput {
  const m = mapState(state);
  const v = view ?? computeMonth(m.input, month);
  const c = state.classic!;
  const layout = layoutFromState(state);
  const catId = (name: string) => m.names.categories.get(name);
  const rules = new Map<string, { bucket: string | null; rule: ClassicRule }>();
  for (const [name, bucket] of c.mapping) { const id = catId(name); if (id) rules.set(id, SPLIT_BUCKETS[bucket] ? { bucket: null, rule: SPLIT_BUCKETS[bucket]! } : { bucket, rule: "none" }); }
  const needed: Record<string, number> = {}, goalMonthly: Record<string, number> = {};
  for (const x of v.categories) { needed[x.categoryId] = x.needed; goalMonthly[x.categoryId] = goalMonthlyAmount(x.goal, x.needed); }
  const typed: Record<string, number> = {};
  if (month === c.month) for (const l of layout) if (l.typed) typed[`${l.column}:${l.name}`] = l.defaultBudget;
  const inc = c.income[month] ?? { D: [0, 0], E: [0, 0] };
  const entry = new Map(m.entries.map((e) => [e.id, e]));
  return {
    month, today, layout, keywords: c.keywords,
    categories: [...m.names.categories].map(([name, id]) => ({ id, name, bucket: rules.get(id)?.bucket ?? null, rule: rules.get(id)?.rule ?? "none" })),
    accounts: m.input.accounts.map((a) => ({ id: a.id, owner: a.owner })),
    needed, goalMonthly, typed,
    income: { D: { budget: toCents(inc.D[0]), actual: toCents(inc.D[1]) }, E: { budget: toCents(inc.E[0]), actual: toCents(inc.E[1]) } },
    transactions: m.input.transactions.map((x) => ({ id: x.id, date: x.date, accountId: x.accountId, payee: entry.get(x.id)?.payee ?? null, hidden: entry.get(x.id)?.hidden ?? false, masked: false, transferToAccountId: x.transferToAccountId ?? null, sharedFiftyFifty: x.sharedFiftyFifty ?? false, lines: x.lines })),
  };
}

/** The goal's monthly amount as the sheet's Classic lines show it: amount per cycle month; a dated goal shows what it needs. */
export function goalMonthlyAmount(goal: { type: string; amount: number; frequencyMonths?: number | null; targetDate?: string | null } | null, needed: number): number {
  if (!goal) return 0;
  if (goal.targetDate) return needed;
  return Math.round(goal.amount / Math.max(1, goal.frequencyMonths ?? 1));
}

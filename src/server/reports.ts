/** Reports payload: the pure report over the loaded budget, plus the names the screen needs. */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { computeReports, type ReportsView } from "../budget/reports.js";
import { loadBudget } from "./month.js";
import { computeSavings, isContribution, type SavingsView } from "../budget/savings.js";
import { computeFlows, type Flows } from "../budget/flows.js";
import { monthOf } from "../budget/dates.js";
import { computeClassic } from "../budget/classic.js";
import { buildClassicInput } from "./classic.js";
import { attributeSpend } from "../budget/classic.js";
import { dueDatesInMonth, dayStillToCome } from "../budget/recurringDates.js";
import type { MonthKey } from "../budget/dates.js";

export interface ReportsPayload extends ReportsView {
  people: { D: string; E: string };
  accountNames: Record<string, string>;
  /** income → groups / contributions / saved, for the Sankey */
  flows: Flows;
}

export async function reportsPayload(db: Db, month: MonthKey, today: string, me = ""): Promise<ReportsPayload> {
  const [{ input, cats, groups }, recurring, users] = await Promise.all([
    loadBudget(db),
    db.select().from(t.recurring).where(eq(t.recurring.active, true)),
    db.select({ name: t.users.displayName, initial: t.users.initial }).from(t.users),
  ]);
  // "who spent" follows the Classic view's routing; one Classic input per month asked for, built lazily
  const classicInputs = new Map<string, Awaited<ReturnType<typeof buildClassicInput>>["ci"]>();
  const classicFor = async (m: MonthKey) => { if (!classicInputs.has(m)) classicInputs.set(m, (await buildClassicInput(db, m, today, me)).ci); return classicInputs.get(m)!; };
  // the report is synchronous, so prepare the months it will ask about (this one and up to five before)
  const wanted: MonthKey[] = [];
  for (let k = 5; k >= 0; k--) { const d = new Date(month + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - k); wanted.push(d.toISOString().slice(0, 10)); }
  for (const m of wanted) await classicFor(m);
  const whoSpent = (m: MonthKey, through: string | null) => { const ci = classicInputs.get(m); return ci ? attributeSpend(ci, through) : { shared: 0, D: 0, E: 0 }; };
  const view = computeReports({
    input, whoSpent,
    categories: cats.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, kind: c.kind, hidden: c.hiddenInBudget })),
    recurring: recurring
      .filter((r) => !r.everyDays || dueDatesInMonth({ dayOfMonth: r.dayOfMonth, everyDays: r.everyDays, anchorDate: r.anchorDate }, month).length)
      .map((r) => ({ id: r.id, payee: r.payee, amount: r.amount, day: r.everyDays ? dayStillToCome({ dayOfMonth: r.dayOfMonth, everyDays: r.everyDays, anchorDate: r.anchorDate }, month, today) : r.dayOfMonth, categoryId: r.categoryId, accountId: r.accountId })),
    month, today,
  });
  const first = (i: string, fallback: string) => users.find((u) => u.initial === i)?.name?.split(" ")[0] ?? fallback;
  const accountNames: Record<string, string> = {};
  for (const a of await db.select({ id: t.accounts.id, name: t.accounts.name }).from(t.accounts)) accountNames[a.id] = a.name;
  const flows = computeFlows(input, month, view.isCurrent ? today : null, cats.map((c) => ({ id: c.id, name: c.name, groupId: c.groupId })), groups.map((g) => ({ id: g.id, name: g.name })));
  return { ...view, people: { D: first("D", "David"), E: first("E", "Elizabeth") }, accountNames, flows };
}

export interface SavingsPayload extends SavingsView {
  people: { D: string; E: string };
  /** Classic's per-person figures for each month: income typed, savings so far, contributions, put away */
  byPerson: Record<string, { D: PersonSavings; E: PersonSavings }>;
}
export interface PersonSavings { income: number; incomeTyped: boolean; spending: number; contributions: number; putAway: number; leftover: number }

export async function savingsPayload(db: Db, today: string, me: string): Promise<SavingsPayload> {
  const [{ input, cats }, users] = await Promise.all([loadBudget(db), db.select({ name: t.users.displayName, initial: t.users.initial }).from(t.users)]);
  const view = computeSavings(input, cats.map((c) => ({ id: c.id, name: c.name })), today);
  const byPerson: SavingsPayload["byPerson"] = {};
  for (const m of view.months) {
    const { ci } = await buildClassicInput(db, m.month, today, me);
    const cv = computeClassic(ci);
    const row = {} as { D: PersonSavings; E: PersonSavings };
    for (const p of ["D", "E"] as const) {
      const x = cv.people[p];
      const income = x.incomeActualTyped ? x.incomeActual : x.incomeBudget;
      // what actually went to retirement/529 categories this month, by who paid: own accounts in full, shared accounts by half
      const contributions = contribByPerson(input, cats, m.month, m.partial ? today : null)[p];
      const spending = x.totalActual - contributions; // Classic counts contributions inside its actuals
      row[p] = { income, incomeTyped: x.incomeActualTyped, spending, contributions, putAway: income - spending, leftover: income - x.totalActual };
    }
    byPerson[m.month] = row;
  }
  const first = (i: string, fallback: string) => users.find((u) => u.initial === i)?.name?.split(" ")[0] ?? fallback;
  return { ...view, people: { D: first("D", "David"), E: first("E", "Elizabeth") }, byPerson };
}

/** Contribution spending split the Classic way: the paying account's owner, a shared account half each. */
function contribByPerson(input: Awaited<ReturnType<typeof loadBudget>>["input"], cats: { id: string; name: string }[], month: string, through: string | null): { D: number; E: number } {
  const ids = new Set(cats.filter((c) => isContribution(c.name)).map((c) => c.id));
  const owner = new Map(input.accounts.map((a) => [a.id, a.owner]));
  const out = { D: 0, E: 0 };
  for (const x of input.transactions) {
    if (monthOf(x.date) !== month || x.confirmed === false || x.transferToAccountId || (through && x.date > through)) continue;
    const who = owner.get(x.accountId);
    for (const l of x.lines) {
      if (!l.categoryId || !ids.has(l.categoryId)) continue;
      const v = -l.amount;
      if (x.sharedFiftyFifty || who === "shared") { out.D += Math.round(v / 2); out.E += v - Math.round(v / 2); }
      else if (who === "D" || who === "E") out[who] += v;
    }
  }
  return out;
}

/** Reports payload: the pure report over the loaded budget, plus the names the screen needs. */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { computeReports, type ReportsView } from "../budget/reports.js";
import { loadBudget } from "./month.js";
import { buildClassicInput } from "./classic.js";
import { attributeSpend } from "../budget/classic.js";
import { dueDatesInMonth, dayStillToCome } from "../budget/recurringDates.js";
import type { MonthKey } from "../budget/dates.js";

export interface ReportsPayload extends ReportsView {
  people: { D: string; E: string };
  accountNames: Record<string, string>;
}

export async function reportsPayload(db: Db, month: MonthKey, today: string, me = ""): Promise<ReportsPayload> {
  const [{ input, cats }, recurring, users] = await Promise.all([
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
  return { ...view, people: { D: first("D", "David"), E: first("E", "Elizabeth") }, accountNames };
}

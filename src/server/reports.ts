/** Reports payload: the pure report over the loaded budget, plus the names the screen needs. */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { computeReports, type ReportsView } from "../budget/reports.js";
import { loadBudget } from "./month.js";
import type { MonthKey } from "../budget/dates.js";

export interface ReportsPayload extends ReportsView {
  people: { D: string; E: string };
}

export async function reportsPayload(db: Db, month: MonthKey, today: string): Promise<ReportsPayload> {
  const [{ input, cats }, recurring, users] = await Promise.all([
    loadBudget(db),
    db.select().from(t.recurring).where(eq(t.recurring.active, true)),
    db.select({ name: t.users.displayName, initial: t.users.initial }).from(t.users),
  ]);
  const view = computeReports({
    input,
    categories: cats.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, kind: c.kind, hidden: c.hiddenInBudget })),
    recurring: recurring.map((r) => ({ id: r.id, payee: r.payee, amount: r.amount, day: r.dayOfMonth, categoryId: r.categoryId })),
    month, today,
  });
  const first = (i: string, fallback: string) => users.find((u) => u.initial === i)?.name?.split(" ")[0] ?? fallback;
  return { ...view, people: { D: first("D", "David"), E: first("E", "Elizabeth") } };
}

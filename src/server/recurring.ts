/**
 * Recurring bills: each active one becomes a pending (unconfirmed) entry once its day of the month arrives;
 * pending entries sit outside every total until confirmed. A bill already entered by hand this month is left alone.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { daysInMonth } from "../budget/dates.js";

export async function createDueRecurring(db: Db, today: string, byUserId: string): Promise<{ created: string[]; skipped: string[] }> {
  const month = today.slice(0, 7) + "-01";
  const day = Number(today.slice(8, 10));
  const [recs, txns] = await Promise.all([
    db.select().from(t.recurring).where(eq(t.recurring.active, true)),
    db.select().from(t.transactions).where(isNull(t.transactions.deletedAt)),
  ]);
  const thisMonth = txns.filter((x) => x.date.startsWith(month.slice(0, 7)));
  const created: string[] = [], skipped: string[] = [];
  for (const r of recs) {
    if (r.lastCreatedMonth && r.lastCreatedMonth >= month) continue;
    const due = Math.min(r.dayOfMonth ?? 1, daysInMonth(month));
    if (day < due) continue;
    const already = thisMonth.some((x) => (x.payee ?? "").trim().toLowerCase() === r.payee.trim().toLowerCase() && x.accountId === r.accountId);
    if (!already) {
      const id = `txn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const date = `${month.slice(0, 7)}-${String(due).padStart(2, "0")}`;
      await db.insert(t.transactions).values({ id, date, accountId: r.accountId, payee: r.payee, memo: r.memo, amount: r.amount, source: "recurring", recurringId: r.id, confirmed: false, createdBy: byUserId, updatedBy: byUserId });
      await db.insert(t.transactionLines).values({ id: `${id}-l1`, transactionId: id, categoryId: r.categoryId, amount: r.amount, sortOrder: 0 });
      created.push(r.payee);
    } else skipped.push(r.payee);
    await db.update(t.recurring).set({ lastCreatedMonth: month }).where(eq(t.recurring.id, r.id));
  }
  return { created, skipped };
}

/** Pending (unconfirmed) entries, oldest first. */
export async function pending(db: Db) {
  const rows = await db.select().from(t.transactions).where(and(eq(t.transactions.confirmed, false), isNull(t.transactions.deletedAt)));
  const lines = await db.select().from(t.transactionLines);
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1)).map((x) => ({ id: x.id, date: x.date, accountId: x.accountId, payee: x.payee, memo: x.memo, amount: x.amount, categoryId: lines.find((l) => l.transactionId === x.id)?.categoryId ?? null, recurringId: x.recurringId }));
}

/** Confirm a pending entry, optionally with the real amount and date. */
export async function confirmEntry(db: Db, me: string, id: string, patch: { amount?: number; date?: string }) {
  const x = (await db.select().from(t.transactions).where(eq(t.transactions.id, id)))[0];
  if (!x) throw new Error("No such entry");
  const amount = patch.amount ?? x.amount;
  await db.update(t.transactions).set({ confirmed: true, amount, date: patch.date ?? x.date, updatedBy: me, updatedAt: new Date() }).where(eq(t.transactions.id, id));
  if (amount !== x.amount) {
    const ls = await db.select().from(t.transactionLines).where(eq(t.transactionLines.transactionId, id));
    if (ls.length === 1) await db.update(t.transactionLines).set({ amount }).where(eq(t.transactionLines.id, ls[0]!.id));
  }
}

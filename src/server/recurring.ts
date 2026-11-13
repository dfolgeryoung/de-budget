/**
 * Recurring bills: each active one becomes a pending (unconfirmed) entry once its day of the month arrives;
 * pending entries sit outside every total until confirmed. A bill already entered by hand this month is left alone.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { dueDatesInMonth, dueNow, isInterval, nextDue } from "../budget/recurringDates.js";

export async function createDueRecurring(db: Db, today: string, byUserId: string): Promise<{ created: string[]; skipped: string[] }> {
  const month = today.slice(0, 7) + "-01";
  const [recs, txns] = await Promise.all([
    db.select().from(t.recurring).where(eq(t.recurring.active, true)),
    db.select().from(t.transactions).where(isNull(t.transactions.deletedAt)),
  ]);
  const created: string[] = [], skipped: string[] = [];
  for (const r of recs) {
    const sched = { dayOfMonth: r.dayOfMonth, everyDays: r.everyDays, anchorDate: r.anchorDate };
    const due = dueNow(sched, today, r.lastCreatedDate, r.lastCreatedMonth);
    for (const date of due) {
      // a bill already entered by hand near that date is left alone (within the month for monthly bills, ±3 days for interval ones)
      const already = txns.some((x) => (x.payee ?? "").trim().toLowerCase() === r.payee.trim().toLowerCase() && x.accountId === r.accountId
        && (isInterval(sched) ? Math.abs(Date.parse(x.date) - Date.parse(date)) <= 3 * 86_400_000 : x.date.startsWith(month.slice(0, 7))));
      if (!already) {
        const id = `txn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        await db.insert(t.transactions).values({ id, date, accountId: r.accountId, payee: r.payee, memo: r.memo, amount: r.amount, source: "recurring", recurringId: r.id, confirmed: false, createdBy: byUserId, updatedBy: byUserId });
        await db.insert(t.transactionLines).values({ id: `${id}-l1`, transactionId: id, categoryId: r.categoryId, amount: r.amount, sortOrder: 0 });
        created.push(r.payee);
      } else skipped.push(r.payee);
      await db.update(t.recurring).set(isInterval(sched) ? { lastCreatedDate: date } : { lastCreatedMonth: month }).where(eq(t.recurring.id, r.id));
    }
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

/**
 * A bill's schedule changed: move this month's pending entry to its new due date, or, when the next due date is still
 * ahead, drop the pending entry and let the bill land again then. Confirmed entries are left alone.
 */
export async function realignPending(db: Db, recurringId: string, today: string) {
  const r = (await db.select().from(t.recurring).where(eq(t.recurring.id, recurringId)))[0];
  if (!r) return;
  const month = today.slice(0, 7) + "-01";
  const sched = { dayOfMonth: r.dayOfMonth, everyDays: r.everyDays, anchorDate: r.anchorDate };
  const pendingNow = (await db.select().from(t.transactions).where(and(eq(t.transactions.recurringId, recurringId), eq(t.transactions.confirmed, false), isNull(t.transactions.deletedAt))))
    .filter((x) => x.date.startsWith(month.slice(0, 7)));
  // interval bills restart from the anchor: forget what was landed and let the next run re-land whatever is due
  if (isInterval(sched)) await db.update(t.recurring).set({ lastCreatedDate: null, lastCreatedMonth: null }).where(eq(t.recurring.id, recurringId));
  if (!pendingNow.length) return;
  const arrived = dueDatesInMonth(sched, month).filter((d) => d <= today);
  if (!arrived.length) {
    for (const x of pendingNow) { await db.delete(t.transactionLines).where(eq(t.transactionLines.transactionId, x.id)); await db.delete(t.transactions).where(eq(t.transactions.id, x.id)); }
    await db.update(t.recurring).set({ lastCreatedMonth: null, lastCreatedDate: null }).where(eq(t.recurring.id, recurringId));
  } else {
    const date = arrived[arrived.length - 1]!;
    for (const x of pendingNow) await db.update(t.transactions).set({ date }).where(eq(t.transactions.id, x.id));
    if (isInterval(sched)) await db.update(t.recurring).set({ lastCreatedDate: date }).where(eq(t.recurring.id, recurringId));
  }
}

/** Skipping a pending entry whose bill is still ahead lets the bill land again on its day. */
export async function skippedPending(db: Db, transactionId: string, today: string): Promise<{ landsAgainOn: number | null }> {
  const x = (await db.select().from(t.transactions).where(eq(t.transactions.id, transactionId)))[0];
  if (!x || x.confirmed || !x.recurringId) return { landsAgainOn: null };
  const r = (await db.select().from(t.recurring).where(eq(t.recurring.id, x.recurringId)))[0];
  if (!r) return { landsAgainOn: null };
  const sched = { dayOfMonth: r.dayOfMonth, everyDays: r.everyDays, anchorDate: r.anchorDate };
  if (!isInterval(sched) && r.dayOfMonth === null) return { landsAgainOn: null };
  const next = nextDue(sched, today);
  if (!next || next <= today || !next.startsWith(today.slice(0, 7))) return { landsAgainOn: null };
  await db.update(t.recurring).set(isInterval(sched) ? { lastCreatedDate: x.date } : { lastCreatedMonth: null }).where(eq(t.recurring.id, r.id));
  return { landsAgainOn: Number(next.slice(8, 10)) };
}

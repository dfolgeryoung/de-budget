/**
 * Tracked amounts: a side ledger for one-off money (a bonus, a gift, a refund). Entries tagged to an amount are
 * deducted from it here and nowhere else — the budget month, income and Classic are unchanged.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";

export const trackedInput = z.object({
  name: z.string().trim().min(1).max(60),
  emoji: z.string().max(8).nullable().default(null),
  amount: z.number().int().positive(),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: z.string().nullable().default(null),
  owner: z.enum(["D", "E", "shared"]).default("shared"),
  note: z.string().max(400).nullable().default(null),
});
export type TrackedInput = z.infer<typeof trackedInput>;

export interface TrackedSummary {
  id: string; name: string; emoji: string | null; amount: number; receivedDate: string; accountId: string | null; accountName: string | null;
  owner: "D" | "E" | "shared"; note: string | null; closed: boolean; spent: number; left: number; entries: number;
}
export interface TrackedEntry { id: string; date: string; payee: string | null; memo: string | null; amount: number; category: string | null; leftAfter: number }

export async function listTracked(db: Db): Promise<TrackedSummary[]> {
  const [rows, txns, accts] = await Promise.all([
    db.select().from(t.trackedAmounts),
    db.select({ id: t.transactions.id, trackedAmountId: t.transactions.trackedAmountId, amount: t.transactions.amount, confirmed: t.transactions.confirmed }).from(t.transactions).where(isNull(t.transactions.deletedAt)),
    db.select({ id: t.accounts.id, name: t.accounts.name }).from(t.accounts),
  ]);
  return rows
    .map((r) => {
      const mine = txns.filter((x) => x.trackedAmountId === r.id && x.confirmed);
      const spent = mine.reduce((s, x) => s - x.amount, 0); // outflows are negative amounts; a refund tagged here gives money back
      return { id: r.id, name: r.name, emoji: r.emoji, amount: r.amount, receivedDate: r.receivedDate, accountId: r.accountId, accountName: accts.find((a) => a.id === r.accountId)?.name ?? null, owner: r.owner, note: r.note, closed: r.closed, spent, left: r.amount - spent, entries: mine.length };
    })
    .sort((a, b) => Number(a.closed) - Number(b.closed) || (a.receivedDate < b.receivedDate ? 1 : -1));
}

/** The entries tagged to one amount, newest first, each with what was left after it (running from the starting amount in date order). */
export async function trackedEntries(db: Db, id: string): Promise<TrackedEntry[]> {
  const [row, txns, lines, cats] = await Promise.all([
    db.select().from(t.trackedAmounts).where(eq(t.trackedAmounts.id, id)).then((r) => r[0]),
    db.select().from(t.transactions).where(and(eq(t.transactions.trackedAmountId, id), isNull(t.transactions.deletedAt), eq(t.transactions.confirmed, true))),
    db.select().from(t.transactionLines),
    db.select({ id: t.categories.id, name: t.categories.name, emoji: t.categories.emoji }).from(t.categories),
  ]);
  if (!row) throw new Error("No such tracked amount");
  const ordered = txns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1));
  let left = row.amount;
  const out: TrackedEntry[] = ordered.map((x) => {
    left += x.amount;
    const ls = lines.filter((l) => l.transactionId === x.id);
    const cat = ls.length > 1 ? "Split across categories" : (() => { const c = cats.find((c) => c.id === ls[0]?.categoryId); return c ? `${c.emoji ? c.emoji + " " : ""}${c.name}` : x.transferToAccountId ? "Transfer" : null; })();
    return { id: x.id, date: x.date, payee: x.payee, memo: x.memo, amount: x.amount, category: cat, leftAfter: left };
  });
  return out.reverse();
}

export async function createTracked(db: Db, me: string, input: TrackedInput) {
  const id = `trk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await db.insert(t.trackedAmounts).values({ id, ...input, updatedBy: me });
  return id;
}

export async function updateTracked(db: Db, me: string, id: string, patch: Partial<TrackedInput> & { closed?: boolean }) {
  await db.update(t.trackedAmounts).set({ ...patch, updatedBy: me, updatedAt: new Date() }).where(eq(t.trackedAmounts.id, id));
}

/** Delete only when nothing is tagged to it; otherwise close it. */
export async function deleteTracked(db: Db, id: string): Promise<"deleted" | "has-entries"> {
  const used = await db.select({ id: t.transactions.id }).from(t.transactions).where(and(eq(t.transactions.trackedAmountId, id), isNull(t.transactions.deletedAt)));
  if (used.length) return "has-entries";
  await db.delete(t.trackedAmounts).where(eq(t.trackedAmounts.id, id));
  return "deleted";
}

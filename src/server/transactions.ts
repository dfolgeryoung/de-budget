/** Ledger: list, create, edit, delete (soft, with undo), duplicates, payee memory. */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { loadBudget } from "./month.js";
import { accountBalance } from "../budget/engine.js";
import { monthOf } from "../budget/dates.js";

export const lineSchema = z.object({ categoryId: z.string().nullable(), amount: z.number().int() });
export const entrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: z.string().min(1),
  payee: z.string().trim().max(120).default(""),
  memo: z.string().trim().max(400).default(""),
  amount: z.number().int(), // signed cents: outflow negative, inflow positive
  transferToAccountId: z.string().nullable().default(null),
  lines: z.array(lineSchema).default([]), // empty + no transfer = one line from categoryId
  categoryId: z.string().nullable().default(null),
  sharedFiftyFifty: z.boolean().default(false),
  hidden: z.boolean().default(false),
  trackedAmountId: z.string().nullable().default(null),
  tagIds: z.array(z.string()).default([]),
});
export type EntryInput = z.infer<typeof entrySchema>;

function linesFor(e: EntryInput): { categoryId: string | null; amount: number }[] {
  if (e.transferToAccountId) return [];
  if (e.lines.length) {
    const sum = e.lines.reduce((s, l) => s + l.amount, 0);
    if (sum !== e.amount) throw new Error(`Split lines add up to ${sum}, not ${e.amount}`);
    return e.lines;
  }
  return [{ categoryId: e.categoryId, amount: e.amount }];
}

export interface LedgerRow {
  id: string; date: string; accountId: string; payee: string | null; memo: string | null; amount: number | null;
  transferToAccountId: string | null; sharedFiftyFifty: boolean; hidden: boolean; mine: boolean; source: string;
  bankStatus: string; bankNote: string | null; confirmed: boolean; trackedAmountId: string | null;
  lines: { categoryId: string | null; amount: number }[]; tagIds: string[]; balance: number | null;
}

export async function listTransactions(db: Db, me: string, q: { accountId?: string; month?: string; categoryId?: string; search?: string; limit?: number }): Promise<LedgerRow[]> {
  const { input } = await loadBudget(db);
  const rows = await db.select().from(t.transactions).where(isNull(t.transactions.deletedAt)).orderBy(desc(t.transactions.date), desc(t.transactions.createdAt));
  const lines = await db.select().from(t.transactionLines);
  const tags = await db.select().from(t.transactionTags);
  const byTxn = new Map<string, { categoryId: string | null; amount: number }[]>();
  for (const l of lines) byTxn.set(l.transactionId, [...(byTxn.get(l.transactionId) ?? []), { categoryId: l.categoryId, amount: l.amount }]);
  const tagsBy = new Map<string, string[]>();
  for (const tg of tags) tagsBy.set(tg.transactionId, [...(tagsBy.get(tg.transactionId) ?? []), tg.tagId]);

  let out = rows.filter((r) => {
    if (q.accountId && r.accountId !== q.accountId && r.transferToAccountId !== q.accountId) return false;
    if (q.month && monthOf(r.date) !== q.month) return false;
    if (q.categoryId && !(byTxn.get(r.id) ?? []).some((l) => l.categoryId === q.categoryId)) return false;
    if (q.search) {
      const s = q.search.toLowerCase();
      const hay = `${r.payee ?? ""} ${r.memo ?? ""} ${(Math.abs(r.amount) / 100).toFixed(2)}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
  if (q.limit) out = out.slice(0, q.limit);

  // running balance when one account is in view (balance after this entry, including 50/50 shares)
  const withBalance = (r: typeof rows[number]): number | null => {
    if (!q.accountId) return null;
    const asOf = r.date;
    // balance through the day, minus later-created same-day entries so the column reads top-down
    let bal = accountBalance(input, q.accountId, asOf);
    for (const o of rows) {
      if (o.date === r.date && o.createdAt > r.createdAt && o.deletedAt === null) {
        if (o.accountId === q.accountId) bal -= o.amount;
        if (o.transferToAccountId === q.accountId) bal += o.amount;
      }
    }
    return bal;
  };

  return out.map((r) => {
    const mine = r.createdBy === me;
    const masked = r.hidden && !mine;
    return {
      id: r.id, date: r.date, accountId: r.accountId,
      payee: masked ? "[Hidden]" : r.payee, memo: masked ? null : r.memo, amount: masked ? null : r.amount,
      transferToAccountId: r.transferToAccountId, sharedFiftyFifty: r.sharedFiftyFifty, hidden: r.hidden, mine, source: r.source,
      bankStatus: r.bankStatus, bankNote: r.bankNote, confirmed: r.confirmed, trackedAmountId: r.trackedAmountId,
      lines: masked ? (byTxn.get(r.id) ?? []).map((l) => ({ categoryId: l.categoryId, amount: 0 })) : (byTxn.get(r.id) ?? []),
      tagIds: tagsBy.get(r.id) ?? [], balance: withBalance(r),
    };
  });
}

const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function createTransaction(db: Db, me: string, e: EntryInput) {
  const lines = linesFor(e);
  const id = newId("txn");
  await db.insert(t.transactions).values({
    id, date: e.date, accountId: e.accountId, payee: e.payee || null, memo: e.memo || null, amount: e.amount,
    transferToAccountId: e.transferToAccountId, sharedFiftyFifty: e.sharedFiftyFifty, hidden: e.hidden, trackedAmountId: e.trackedAmountId,
    source: "manual", createdBy: me, updatedBy: me,
  });
  if (lines.length) await db.insert(t.transactionLines).values(lines.map((l, i) => ({ id: `${id}-l${i + 1}`, transactionId: id, categoryId: l.categoryId, amount: l.amount, sortOrder: i })));
  if (e.tagIds.length) await db.insert(t.transactionTags).values(e.tagIds.map((tagId) => ({ transactionId: id, tagId })));
  await rememberPayee(db, e, lines);
  return id;
}

export async function updateTransaction(db: Db, me: string, id: string, e: EntryInput) {
  const lines = linesFor(e);
  const existing = (await db.select().from(t.transactions).where(eq(t.transactions.id, id)))[0];
  if (!existing) throw new Error("No such entry");
  if (existing.hidden && existing.createdBy !== me) throw new Error("That entry is hidden by the other person");
  await db.update(t.transactions).set({
    date: e.date, accountId: e.accountId, payee: e.payee || null, memo: e.memo || null, amount: e.amount,
    transferToAccountId: e.transferToAccountId, sharedFiftyFifty: e.sharedFiftyFifty, hidden: e.hidden, trackedAmountId: e.trackedAmountId,
    confirmed: true, // saving a pending recurring entry confirms it
    updatedBy: me, updatedAt: new Date(),
  }).where(eq(t.transactions.id, id));
  await db.delete(t.transactionLines).where(eq(t.transactionLines.transactionId, id));
  if (lines.length) await db.insert(t.transactionLines).values(lines.map((l, i) => ({ id: `${id}-l${i + 1}`, transactionId: id, categoryId: l.categoryId, amount: l.amount, sortOrder: i })));
  await db.delete(t.transactionTags).where(eq(t.transactionTags.transactionId, id));
  if (e.tagIds.length) await db.insert(t.transactionTags).values(e.tagIds.map((tagId) => ({ transactionId: id, tagId })));
  await rememberPayee(db, e, lines);
}

export async function deleteTransaction(db: Db, me: string, id: string, undo = false) {
  const existing = (await db.select().from(t.transactions).where(eq(t.transactions.id, id)))[0];
  if (!existing) throw new Error("No such entry");
  if (existing.hidden && existing.createdBy !== me) throw new Error("That entry is hidden by the other person");
  await db.update(t.transactions).set({ deletedAt: undo ? null : new Date(), updatedBy: me, updatedAt: new Date() }).where(eq(t.transactions.id, id));
}

/** Same payee and amount within 3 days (the sheet's duplicate rule). */
export async function findDuplicate(db: Db, payee: string, amount: number, date: string, excludeId?: string) {
  if (!payee) return null;
  const rows = await db.select({ id: t.transactions.id, date: t.transactions.date, payee: t.transactions.payee, amount: t.transactions.amount })
    .from(t.transactions)
    .where(and(isNull(t.transactions.deletedAt), eq(t.transactions.amount, amount), sql`lower(${t.transactions.payee}) = ${payee.toLowerCase()}`, sql`abs(${t.transactions.date}::date - ${date}::date) <= 3`));
  return rows.find((r) => r.id !== excludeId) ?? null;
}

async function rememberPayee(db: Db, e: EntryInput, lines: { categoryId: string | null; amount: number }[]) {
  if (!e.payee || e.transferToAccountId) return;
  const cat = lines.length === 1 ? lines[0]!.categoryId : null;
  await db.insert(t.payees).values({ id: `payee-${e.payee.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: e.payee, lastCategoryId: cat, lastAccountId: e.accountId })
    .onConflictDoUpdate({ target: t.payees.name, set: { lastCategoryId: cat, lastAccountId: e.accountId, updatedAt: new Date() } });
}

/** Everything the entry form needs to offer in its pickers. */
export async function lists(db: Db, me: string) {
  const [accts, groups, cats, payees, tagRows, tracked] = await Promise.all([
    db.select().from(t.accounts), db.select().from(t.categoryGroups), db.select().from(t.categories), db.select().from(t.payees), db.select().from(t.tags),
    db.select().from(t.trackedAmounts).where(eq(t.trackedAmounts.closed, false)),
  ]);
  return {
    accounts: accts.filter((a) => !a.closed).sort((a, b) => a.sortOrder - b.sortOrder).map((a) => ({ id: a.id, name: a.name, type: a.type, owner: a.owner })),
    groups: groups.sort((a, b) => a.sortOrder - b.sortOrder).map((g) => ({
      id: g.id, name: g.name, system: g.system,
      categories: cats.filter((c) => c.groupId === g.id && !c.hiddenInBudget).sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, kind: c.kind, favourite: (() => { const v = c.favouriteOrder?.[me] ?? c.favouriteOrder?._ ?? null; return v === null || v < 0 ? null : v; })() })),
    })),
    payees: payees.sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ name: p.name, lastCategoryId: p.lastCategoryId, lastAccountId: p.lastAccountId })),
    tags: tagRows.sort((a, b) => a.sortOrder - b.sortOrder).map((x) => ({ id: x.id, name: x.name, color: x.color })),
    tracked: tracked.map((x) => ({ id: x.id, name: x.name, emoji: x.emoji })),
  };
}

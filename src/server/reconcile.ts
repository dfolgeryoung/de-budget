/**
 * CSV reconciliation: match a bank export against one account's entries, suggest what's missing, and mark what doesn't line up.
 * Matching is by amount and a date within four days (bank purchase date or posting date), each entry used at most once.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { parseBankCsv, type BankRow } from "../budget/bankCsv.js";
import { createTransaction } from "./transactions.js";
import { accountBalance } from "../budget/engine.js";
import { loadBudget } from "./month.js";

export interface ReconcilePreview {
  account: { id: string; name: string };
  bank: { account: string | null; balance: number | null; asOf: string | null; rows: number; from: string | null; to: string | null };
  appBalance: number;
  matched: { id: string; date: string; payee: string | null; amount: number; bankDate: string; bankPayee: string }[];
  newRows: { key: number; date: string; postedDate: string; payee: string; description: string; amount: number; transfer: boolean; suggestedCategoryId: string | null; suggestedPayee: string | null; bankCategory: string | null }[];
  missing: { id: string; date: string; payee: string | null; amount: number; pending: boolean }[];
}

const daysApart = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);

export async function previewReconcile(db: Db, accountId: string, csvText: string, today: string): Promise<ReconcilePreview> {
  const file = parseBankCsv(csvText);
  const [acct, txns, payees] = await Promise.all([
    db.select().from(t.accounts).where(eq(t.accounts.id, accountId)).then((r) => r[0]),
    db.select().from(t.transactions).where(isNull(t.transactions.deletedAt)),
    db.select().from(t.payees),
  ]);
  if (!acct) throw new Error("No such account");
  const dates = file.rows.map((r) => r.date).sort();
  const from = dates[0] ?? null, to = file.asOf ?? dates[dates.length - 1] ?? null;
  // this account's entries, with the amount as the bank would see it
  const mine = txns.filter((x) => x.accountId === accountId || x.transferToAccountId === accountId).map((x) => ({ id: x.id, date: x.date, payee: x.payee, confirmed: x.confirmed, seen: x.accountId === accountId ? x.amount : -x.amount }));
  const { matched, newRows, missing } = matchBank(file.rows, mine, payees.map((p) => ({ name: p.name, lastCategoryId: p.lastCategoryId })), from, to);
  const { input } = await loadBudget(db);
  return { account: { id: acct.id, name: acct.name }, bank: { account: file.account, balance: file.balance, asOf: file.asOf, rows: file.rows.length, from, to }, appBalance: accountBalance(input, accountId, today), matched, newRows, missing };
}

/** Pure matching: each bank row takes the closest unused entry with the same amount within four days; the rest is new or missing. */
export function matchBank(rows: BankRow[], mine: { id: string; date: string; payee: string | null; confirmed: boolean; seen: number }[], payees: { name: string; lastCategoryId: string | null }[], from: string | null, to: string | null) {
  const used = new Set<string>();
  const matched: ReconcilePreview["matched"] = [];
  const newRows: ReconcilePreview["newRows"] = [];
  rows.forEach((r, key) => {
    const dist = (x: { date: string }) => Math.min(daysApart(x.date, r.date), daysApart(x.date, r.postedDate));
    const hit = mine.filter((x) => !used.has(x.id) && x.seen === r.amount && dist(x) <= 4).sort((a, b) => dist(a) - dist(b))[0];
    if (hit) { used.add(hit.id); matched.push({ id: hit.id, date: hit.date, payee: hit.payee, amount: hit.seen, bankDate: r.date, bankPayee: r.payee }); return; }
    const lower = r.payee.toLowerCase(), first = lower.split(" ")[0] ?? "";
    const known = payees.find((p) => p.name.toLowerCase() === lower) ?? payees.find((p) => first.length >= 4 && (lower.includes(p.name.toLowerCase()) || p.name.toLowerCase().startsWith(first)));
    newRows.push({ key, date: r.date, postedDate: r.postedDate, payee: r.payee, description: r.description, amount: r.amount, transfer: r.transfer, suggestedCategoryId: known?.lastCategoryId ?? null, suggestedPayee: known?.name ?? null, bankCategory: r.bankCategory });
  });
  const missing = mine.filter((x) => !used.has(x.id) && from && to && x.date >= from && x.date <= to)
    .map((x) => ({ id: x.id, date: x.date, payee: x.payee, amount: x.seen, pending: !x.confirmed })).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { matched, newRows, missing };
}

export async function applyReconcile(db: Db, me: string, accountId: string, body: { matched: string[]; mismatches: { id: string; note: string }[]; add: { date: string; payee: string; memo: string; amount: number; categoryId: string | null; transferToAccountId: string | null }[] }) {
  for (const id of body.matched) await db.update(t.transactions).set({ bankStatus: "matched", bankNote: null, updatedBy: me, updatedAt: new Date() }).where(and(eq(t.transactions.id, id), isNull(t.transactions.deletedAt)));
  for (const m of body.mismatches) await db.update(t.transactions).set({ bankStatus: "mismatch", bankNote: m.note, updatedBy: me, updatedAt: new Date() }).where(eq(t.transactions.id, m.id));
  let added = 0;
  for (const a of body.add) {
    const r = await createTransaction(db, me, { date: a.date, accountId, payee: a.payee, memo: a.memo, amount: a.amount, categoryId: a.transferToAccountId ? null : a.categoryId, lines: [], transferToAccountId: a.transferToAccountId, sharedFiftyFifty: false, hidden: false, trackedAmountId: null, tagIds: [] });
    const id = typeof r === "string" ? r : (r as { id: string }).id;
    await db.update(t.transactions).set({ source: "import", bankStatus: "matched" }).where(eq(t.transactions.id, id));
    added++;
  }
  return { matched: body.matched.length, mismatches: body.mismatches.length, added };
}

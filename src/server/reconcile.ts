/**
 * CSV reconciliation: match a bank export against one account's entries, suggest what's missing, and mark what doesn't line up.
 * Matching is by amount and a date within four days (bank purchase date or posting date), each entry used at most once.
 *
 * The bank never agrees with the app line for line on a 50/50 household, so the reconciler knows the pattern:
 *   - a split entry is matched by its full amount on the payer's account (the app only charges them half);
 *   - money moving between the two of you (transfers between your checking accounts, Venmo to each other) is a
 *     settlement of those halves, not an entry: it's set apart and totted up against what the splits say is owed;
 *   - a bank row with no exact match but an app entry nearby for a different amount is flagged as "amount differs"
 *     rather than offered as new (a Venmo cashout that bundled a reimbursement, a typo).
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
  newRows: { key: number; date: string; postedDate: string; payee: string; description: string; amount: number; transfer: boolean; suggestedCategoryId: string | null; suggestedPayee: string | null; bankCategory: string | null; near?: { id: string; date: string; payee: string | null; amount: number } }[];
  missing: { id: string; date: string; payee: string | null; amount: number; pending: boolean }[];
  /** bank rows that move money between the two of you: not entries, they settle the 50/50 halves */
  settlements: { key: number; date: string; payee: string; description: string; amount: number }[];
  /** what the splits in this period say the other person owes the owner of this account, against what actually moved */
  splits: { me: string; other: string; owedToMe: number; settled: number; stillOwed: number; items: { date: string; payee: string | null; amount: number; paidBy: string }[] } | null;
}

const daysApart = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);

export async function previewReconcile(db: Db, accountId: string, csvText: string, today: string): Promise<ReconcilePreview> {
  const file = parseBankCsv(csvText);
  const [accts, txns, payees, users] = await Promise.all([
    db.select().from(t.accounts),
    db.select().from(t.transactions).where(isNull(t.transactions.deletedAt)),
    db.select().from(t.payees),
    db.select({ initial: t.users.initial, name: t.users.displayName }).from(t.users),
  ]);
  const acct = accts.find((a) => a.id === accountId);
  if (!acct) throw new Error("No such account");
  // remember which bank account this is, so transfers between the two of you can be recognised next time
  const own4 = file.account?.replace(/\D/g, "").slice(-4) || null;
  if (own4 && acct.bankLast4 !== own4) { await db.update(t.accounts).set({ bankLast4: own4 }).where(eq(t.accounts.id, accountId)); acct.bankLast4 = own4; }
  const dates = file.rows.map((r) => r.date).sort();
  const from = dates[0] ?? null, to = file.asOf ?? dates[dates.length - 1] ?? null;
  // this account's entries, with the amount as the bank would see it
  const mine = txns.filter((x) => x.accountId === accountId || x.transferToAccountId === accountId).map((x) => ({ id: x.id, date: x.date, payee: x.payee, confirmed: x.confirmed, seen: x.accountId === accountId ? x.amount : -x.amount }));
  // the other person: their first name and the last-4 of their checking accounts, for spotting settlements
  const me = acct.owner, other = me === "D" ? "E" : me === "E" ? "D" : null;
  const firstName = (i: string) => users.find((u) => u.initial === i)?.name.split(" ")[0] ?? (i === "D" ? "David" : "Elizabeth");
  const theirChecking = other ? accts.filter((a) => a.owner === other && a.type === "checking" && !a.closed) : [];
  const spouse = other ? { name: firstName(other), last4: theirChecking.map((a) => a.bankLast4).filter((x): x is string => !!x), oneChecking: theirChecking.length === 1 } : null;
  const { matched, newRows, missing, settlements } = matchBank(file.rows, mine, payees.map((p) => ({ name: p.name, lastCategoryId: p.lastCategoryId })), from, to, spouse);
  // what the splits say: halves the other person owes me, less halves I owe them, within the export's dates
  let splits: ReconcilePreview["splits"] = null;
  if (other && from && to) {
    const owner = new Map(accts.map((a) => [a.id, a.owner]));
    const items = txns.filter((x) => x.sharedFiftyFifty && !x.transferToAccountId && x.confirmed && x.date >= from && x.date <= to && (owner.get(x.accountId) === me || owner.get(x.accountId) === other))
      .map((x) => ({ date: x.date, payee: x.payee, amount: x.amount, paidBy: owner.get(x.accountId) === me ? firstName(me) : firstName(other) }));
    const owedToMe = items.reduce((s, x) => s + (x.paidBy === firstName(me) ? Math.round(-x.amount / 2) : -Math.round(-x.amount / 2)), 0);
    const settled = settlements.reduce((s, r) => s + r.amount, 0);
    splits = { me: firstName(me), other: firstName(other), owedToMe, settled, stillOwed: owedToMe - settled, items };
  }
  const { input } = await loadBudget(db);
  return { account: { id: acct.id, name: acct.name }, bank: { account: file.account, balance: file.balance, asOf: file.asOf, rows: file.rows.length, from, to }, appBalance: accountBalance(input, accountId, today), matched, newRows, missing, settlements, splits };
}

/** Pure matching: each bank row takes the closest unused entry with the same amount within four days; the rest is new or missing. */
export function matchBank(rows: BankRow[], mine: { id: string; date: string; payee: string | null; confirmed: boolean; seen: number }[], payees: { name: string; lastCategoryId: string | null }[], from: string | null, to: string | null, spouse: { name: string; last4: string[]; oneChecking: boolean } | null = null) {
  const used = new Set<string>();
  const matched: ReconcilePreview["matched"] = [];
  const newRows: ReconcilePreview["newRows"] = [];
  const settlements: ReconcilePreview["settlements"] = [];
  const isSettlement = (r: BankRow) => {
    if (!spouse) return false;
    const d = r.description.toUpperCase();
    if (new RegExp(`VENMO\\s*\\*?\\s*${spouse.name.toUpperCase()}\\b`).test(d)) return true; // Venmo to or from them
    if (!r.transfer) return false;
    const m = d.match(/(?:TO|FROM)\s+DD\s+\*+(\d{4})/); // SECU: "TRANSFER CREDIT TO DD ******4212"
    if (!m) return false;
    return spouse.last4.includes(m[1]!) || (spouse.last4.length === 0 && spouse.oneChecking);
  };
  const pending: { r: BankRow; key: number }[] = [];
  rows.forEach((r, key) => {
    const dist = (x: { date: string }) => Math.min(daysApart(x.date, r.date), daysApart(x.date, r.postedDate));
    const hit = mine.filter((x) => !used.has(x.id) && x.seen === r.amount && dist(x) <= 4).sort((a, b) => dist(a) - dist(b))[0];
    if (hit) { used.add(hit.id); matched.push({ id: hit.id, date: hit.date, payee: hit.payee, amount: hit.seen, bankDate: r.date, bankPayee: r.payee }); return; }
    if (isSettlement(r)) { settlements.push({ key, date: r.date, payee: r.payee, description: r.description, amount: r.amount }); return; }
    pending.push({ r, key });
  });
  // second pass for the leftovers: an unused entry nearby with the same sign and a payee in common is "amount differs", not new
  const words = (s: string | null) => new Set((s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
  for (const { r, key } of pending) {
    const dist = (x: { date: string }) => Math.min(daysApart(x.date, r.date), daysApart(x.date, r.postedDate));
    const bw = words(r.payee);
    const near = mine.filter((x) => !used.has(x.id) && Math.sign(x.seen) === Math.sign(r.amount) && dist(x) <= 4 && [...words(x.payee)].some((w) => bw.has(w))).sort((a, b) => Math.abs(a.seen - r.amount) - Math.abs(b.seen - r.amount))[0];
    const lower = r.payee.toLowerCase(), first = lower.split(" ")[0] ?? "";
    const known = payees.find((p) => p.name.toLowerCase() === lower) ?? payees.find((p) => first.length >= 4 && (lower.includes(p.name.toLowerCase()) || p.name.toLowerCase().startsWith(first)));
    newRows.push({ key, date: r.date, postedDate: r.postedDate, payee: r.payee, description: r.description, amount: r.amount, transfer: r.transfer, suggestedCategoryId: known?.lastCategoryId ?? null, suggestedPayee: known?.name ?? null, bankCategory: r.bankCategory, ...(near ? { near: { id: near.id, date: near.date, payee: near.payee, amount: near.seen } } : {}) });
  }
  const missing = mine.filter((x) => !used.has(x.id) && from && to && x.date >= from && x.date <= to)
    .map((x) => ({ id: x.id, date: x.date, payee: x.payee, amount: x.seen, pending: !x.confirmed })).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { matched, newRows, missing, settlements };
}

export async function applyReconcile(db: Db, me: string, accountId: string, body: { matched: string[]; mismatches: { id: string; note: string }[]; add: { date: string; payee: string; memo: string; amount: number; categoryId: string | null; transferToAccountId: string | null }[] }) {
  for (const id of body.matched) await db.update(t.transactions).set({ bankStatus: "matched", bankNote: null, updatedBy: me, updatedAt: new Date() }).where(and(eq(t.transactions.id, id), isNull(t.transactions.deletedAt)));
  for (const m of body.mismatches) await db.update(t.transactions).set({ bankStatus: "mismatch", bankNote: m.note, updatedBy: me, updatedAt: new Date() }).where(eq(t.transactions.id, m.id));
  let added = 0;
  for (const a of body.add) {
    const r = await createTransaction(db, me, { date: a.date, accountId, payee: a.payee, memo: a.memo, amount: a.amount, categoryId: a.transferToAccountId ? null : a.categoryId, lines: [], transferToAccountId: a.transferToAccountId, sharedFiftyFifty: false, hidden: false, trackedAmountId: null, tagIds: [], location: null });
    const id = typeof r === "string" ? r : (r as { id: string }).id;
    await db.update(t.transactions).set({ source: "import", bankStatus: "matched" }).where(eq(t.transactions.id, id));
    added++;
  }
  return { matched: body.matched.length, mismatches: body.mismatches.length, added };
}

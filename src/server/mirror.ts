/**
 * The bridge to the spreadsheet while both run:
 *  - mirror: write the app's transactions into the sheet's Ledger (rows 5+, newest first, the sheet's own encoding),
 *    each live month's Assigned column, and the Money moves log. The sheet's formulas and Classic tab keep working.
 *  - inbox: rows typed into the sheet's Inbox tab (AppSheet) become app transactions, then get stamped "Added".
 *  - backup: optionally copy the spreadsheet into a Drive folder once a day.
 * Settings keys: sheet_id (or SHEET_ID env), mirror_last (status), live_months.
 */
import { eq, isNull, desc } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { sheets, driveCopy, serviceAccount } from "./google.js";
import { createTransaction } from "./transactions.js";
import { dt, num } from "../budget/parseExport.js";

const LEDGER_FIRST = 5; // row 4 is the sheet's entry row
const LEDGER_LAST = 2000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const tabName = (month: string) => `${MON[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const usDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`;
const dollars = (cents: number) => Math.round(cents) / 100;

export interface MirrorResult { ledgerRows: number; months: string[]; moves: number; inboxAdded: number; backup?: string; warnings: string[]; at: string }

async function setting<T>(db: Db, key: string): Promise<T | null> {
  const r = await db.select().from(t.settings).where(eq(t.settings.key, key));
  return (r[0]?.value as T | undefined) ?? null;
}
async function putSetting(db: Db, key: string, value: unknown) {
  await db.insert(t.settings).values({ key, value: value as object, updatedAt: new Date() }).onConflictDoUpdate({ target: t.settings.key, set: { value: value as object, updatedAt: new Date() } });
}

export async function sheetId(db: Db): Promise<string | null> {
  return process.env.SHEET_ID || (await setting<string>(db, "sheet_id"));
}

export function mirrorConfigured(): boolean { return !!serviceAccount(); }

export interface LedgerTxn { id: string; date: string; accountId: string; payee: string | null; memo: string | null; amount: number; transferToAccountId: string | null; sharedFiftyFifty: boolean; hidden: boolean; lines: { categoryId: string | null; amount: number }[] }

/** Transactions as Ledger rows F..M: [hidden, date, account, payee, category, memo, outflow, inflow] — the sheet's own encoding. */
export function encodeLedger(txns: LedgerTxn[], acct: Map<string, string>, cat: Map<string, string>): (string | number | boolean | null)[][] {
  const out: (string | number | boolean | null)[][] = [];
  const money = (amount: number): [number | null, number | null] => (amount < 0 ? [dollars(-amount), null] : amount > 0 ? [null, dollars(amount)] : [null, null]);
  for (const x of txns) {
    const hidden = x.hidden ? true : null;
    const payee = x.payee ?? "";
    if (x.transferToAccountId) {
      // the sheet writes a transfer as Account = source, Category = Transfer: target, Outflow
      const [src, dst, amt] = x.amount <= 0 ? [x.accountId, x.transferToAccountId, -x.amount] : [x.transferToAccountId, x.accountId, x.amount];
      out.push([hidden, usDate(x.date), acct.get(src) ?? "", payee, `Transfer: ${acct.get(dst) ?? ""}`, x.memo ?? "", dollars(amt), null]);
      continue;
    }
    const account = (acct.get(x.accountId) ?? "") + (x.sharedFiftyFifty ? " (split)" : "");
    if (x.lines.length > 1) {
      const [o, i] = money(x.amount);
      out.push([hidden, usDate(x.date), account, payee, "Split across categories", x.memo ?? "", o, i]);
      for (const l of x.lines) { const [lo, li] = money(l.amount); out.push([null, usDate(x.date), "", `↳ ${payee}`, l.categoryId ? cat.get(l.categoryId) ?? "" : "Ready to Assign", "", lo, li]); }
      continue;
    }
    const [o, i] = money(x.amount);
    const c = x.lines[0]?.categoryId ? cat.get(x.lines[0].categoryId) ?? "" : "Ready to Assign";
    out.push([hidden, usDate(x.date), account, payee, c, x.memo ?? "", o, i]);
  }
  return out;
}

export async function ledgerRows(db: Db): Promise<(string | number | boolean | null)[][]> {
  const [txns, lines, accts, cats] = await Promise.all([
    db.select().from(t.transactions).where(isNull(t.transactions.deletedAt)).orderBy(desc(t.transactions.date), desc(t.transactions.createdAt)),
    db.select().from(t.transactionLines),
    db.select().from(t.accounts),
    db.select().from(t.categories),
  ]);
  const byTxn = new Map<string, { categoryId: string | null; amount: number; sortOrder: number }[]>();
  for (const l of lines) { const a = byTxn.get(l.transactionId) ?? []; a.push(l); byTxn.set(l.transactionId, a); }
  return encodeLedger(
    txns.map((x) => ({ ...x, lines: (byTxn.get(x.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder) })),
    new Map(accts.map((a) => [a.id, a.name])), new Map(cats.map((c) => [c.id, c.name])),
  );
}

export async function mirrorToSheet(db: Db, me: string, opts: { backup?: boolean } = {}): Promise<MirrorResult> {
  const id = await sheetId(db);
  if (!id) throw new Error("No spreadsheet id: set SHEET_ID or save it under Settings › Sheet mirror");
  const warnings: string[] = [];

  // 1. Ledger
  const rows = await ledgerRows(db);
  if (rows.length > LEDGER_LAST - LEDGER_FIRST + 1) warnings.push(`Ledger holds ${LEDGER_LAST - LEDGER_FIRST + 1} rows; ${rows.length - (LEDGER_LAST - LEDGER_FIRST + 1)} oldest entries were not written`);
  const fit = rows.slice(0, LEDGER_LAST - LEDGER_FIRST + 1);
  await sheets.clear(id, [`Ledger!F${LEDGER_FIRST}:M${LEDGER_LAST}`]);
  await sheets.batchUpdate(id, [{ range: `Ledger!F${LEDGER_FIRST}:M${LEDGER_FIRST + fit.length - 1}`, values: fit }]);

  // 2. Assigned per live month tab (rows found by category name in column D)
  const tabs = new Set(await sheets.tabs(id));
  const live = (await setting<string[]>(db, "live_months")) ?? [];
  const cats = await db.select().from(t.categories);
  const asgs = await db.select().from(t.assignments);
  const months: string[] = [];
  for (const month of live) {
    const tab = tabName(month);
    if (!tabs.has(tab)) { warnings.push(`No tab "${tab}" in the sheet`); continue; }
    const names = await sheets.get(id, `'${tab}'!D1:D200`, true);
    const assigned = new Map(asgs.filter((a) => a.month === month).map((a) => [a.categoryId, a.amount]));
    const data: { range: string; values: (number | null)[][] }[] = [];
    for (const c of cats) {
      const r = names.findIndex((row) => (row[0] ?? "").trim() === c.name);
      if (r < 0) continue;
      data.push({ range: `'${tab}'!F${r + 1}`, values: [[dollars(assigned.get(c.id) ?? 0)]] });
    }
    await sheets.batchUpdate(id, data);
    months.push(tab);
  }

  // 3. Money moves: rewrite the log from the app's moves (newest first), keeping the header row
  let moves = 0;
  if (tabs.has("Money moves")) {
    const mv = await db.select().from(t.moneyMoves).where(eq(t.moneyMoves.undone, false)).orderBy(desc(t.moneyMoves.at));
    const cat = new Map(cats.map((c) => [c.id, c.name]));
    const how: Record<string, string> = { move: "Move Money", spread: "Spread", typed: "Typed in Assigned", auto_assign: "Auto-assign", reset: "Reset", release: "Next Month's Money released", savings_sync: "Savings transfer" };
    const vals = mv.map((m) => [`${usDate(m.at.toISOString().slice(0, 10))} ${m.at.toISOString().slice(11, 16)}`, tabName(m.month), m.fromCategoryId ? cat.get(m.fromCategoryId) ?? "" : "Ready to Assign", m.toCategoryId ? cat.get(m.toCategoryId) ?? "" : "Ready to Assign", dollars(m.amount), how[m.how] ?? m.how]);
    await sheets.clear(id, ["'Money moves'!A2:F2000"]);
    if (vals.length) await sheets.batchUpdate(id, [{ range: `'Money moves'!A2:F${vals.length + 1}`, values: vals }]);
    moves = vals.length;
  }

  // 4. optional Drive backup
  let backup: string | undefined;
  const folder = process.env.BACKUP_FOLDER_ID;
  if (opts.backup && folder) {
    try { backup = await driveCopy(id, `DE Budget backup ${new Date().toISOString().slice(0, 10)}`, folder); }
    catch (e) { warnings.push(`Backup failed: ${(e as Error).message}`); }
  }

  const result: MirrorResult = { ledgerRows: fit.length, months, moves, inboxAdded: 0, backup, warnings, at: new Date().toISOString() };
  await putSetting(db, "mirror_last", { ...result, by: me });
  return result;
}

/** Inbox rows (Date, Account, Payee, Category, Memo, Outflow, Inflow, Added) without an Added stamp become app entries. */
export async function pickUpInbox(db: Db, me: string): Promise<{ added: number; skipped: string[] }> {
  const id = await sheetId(db);
  if (!id) throw new Error("No spreadsheet id");
  const tabs = new Set(await sheets.tabs(id));
  if (!tabs.has("Inbox")) return { added: 0, skipped: ["No Inbox tab"] };
  const rows = await sheets.get(id, "Inbox!A2:H500", true);
  const [accts, cats] = await Promise.all([db.select().from(t.accounts), db.select().from(t.categories)]);
  const acct = new Map(accts.map((a) => [a.name.trim().toLowerCase(), a.id]));
  const cat = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const skipped: string[] = [];
  const stamps: { range: string; values: string[][] }[] = [];
  let added = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!r.some((v) => v.trim())) continue;
    if ((r[7] ?? "").trim()) continue; // already added
    const date = dt(r[0]) ?? null;
    const accountName = (r[1] ?? "").trim().replace(/ \(split\)$/i, "");
    const accountId = acct.get(accountName.toLowerCase());
    const catName = (r[3] ?? "").trim();
    const out = num(r[5]) ?? 0, inn = num(r[6]) ?? 0;
    const amount = Math.round((inn - out) * 100);
    const rowNo = i + 2;
    if (!date || !accountId || !amount) { skipped.push(`Inbox row ${rowNo}: needs a date, a known account and an amount`); continue; }
    let categoryId: string | null = null, transferToAccountId: string | null = null;
    if (/^transfer: /i.test(catName)) {
      transferToAccountId = acct.get(catName.slice(10).trim().toLowerCase()) ?? null;
      if (!transferToAccountId) { skipped.push(`Inbox row ${rowNo}: unknown transfer target "${catName.slice(10)}"`); continue; }
    } else if (catName && catName.toLowerCase() !== "ready to assign") {
      categoryId = cat.get(catName.toLowerCase()) ?? null;
      if (!categoryId) { skipped.push(`Inbox row ${rowNo}: unknown category "${catName}"`); continue; }
    }
    await createTransaction(db, me, { date, accountId, payee: (r[2] ?? "").trim(), memo: (r[4] ?? "").trim(), amount, categoryId, lines: [], transferToAccountId, sharedFiftyFifty: /\(split\)$/i.test((r[1] ?? "").trim()), hidden: false, trackedAmountId: null, tagIds: [] });
    stamps.push({ range: `Inbox!H${rowNo}`, values: [[`Added ${new Date().toISOString().slice(0, 16).replace("T", " ")}`]] });
    added++;
  }
  await sheets.batchUpdate(id, stamps);
  return { added, skipped };
}

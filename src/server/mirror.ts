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

export interface MirrorResult { ledgerRows: number; months: string[]; moves: number; inboxAdded: number; reconciled: number; backup?: string; warnings: string[]; at: string }

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
  return encodeLedgerGroups(txns, acct, cat).flatMap((g) => g.rows);
}
export type LedgerCell = string | number | boolean | null;
/** The same, one group of rows per transaction (a split is its parent row plus its ↳ children). */
export function encodeLedgerGroups(txns: LedgerTxn[], acct: Map<string, string>, cat: Map<string, string>): { txn: LedgerTxn; rows: LedgerCell[][] }[] {
  const groups: { txn: LedgerTxn; rows: LedgerCell[][] }[] = [];
  const money = (amount: number): [number | null, number | null] => (amount < 0 ? [dollars(-amount), null] : amount > 0 ? [null, dollars(amount)] : [null, null]);
  for (const x of txns) {
    const out: LedgerCell[][] = [];
    groups.push({ txn: x, rows: out });
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
  return groups;
}

/** A Ledger row as read back from the sheet (formatted values). */
export type SheetLedgerRow = [hidden: string, date: string, account: string, payee: string, category: string, memo: string, outflow: string, inflow: string];
export interface ParsedEntry { date: string; account: string; payee: string; memo: string; hidden: boolean; split: boolean; transferTo: string | null; amount: number; lines: { category: string; amount: number }[] }

/** Read the sheet's Ledger rows back into entries (splits regrouped with their ↳ children). Rows without a date are skipped. */
export function parseLedgerRows(rows: SheetLedgerRow[]): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  const amt = (o: string, i: string) => Math.round(((num(i) ?? 0) - (num(o) ?? 0)) * 100);
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k]!;
    const date = dt(r[1]);
    if (!date || (r[3] ?? "").startsWith("↳ ")) continue; // children are taken with their parent
    const rawAccount = (r[2] ?? "").trim();
    const split = / \(split\)$/i.test(rawAccount);
    const account = rawAccount.replace(/ \(split\)$/i, "");
    const category = (r[4] ?? "").trim();
    const e: ParsedEntry = { date, account, payee: (r[3] ?? "").trim(), memo: (r[5] ?? "").trim(), hidden: (r[0] ?? "").trim().toUpperCase() === "TRUE", split, transferTo: null, amount: amt(r[6] ?? "", r[7] ?? ""), lines: [] };
    if (/^transfer: /i.test(category)) {
      // the sheet lists a transfer from its source; an inflow written on the target side reads as the reverse
      e.transferTo = category.slice(10).trim();
      if (e.amount > 0) { const target = e.account; e.account = e.transferTo; e.transferTo = target; e.amount = -e.amount; }
    }
    else if (category === "Split across categories") {
      for (let j = k + 1; j < rows.length && (rows[j]![3] ?? "").startsWith("↳ ") && !(rows[j]![2] ?? "").trim(); j++) e.lines.push({ category: (rows[j]![4] ?? "").trim(), amount: amt(rows[j]![6] ?? "", rows[j]![7] ?? "") });
    } else e.lines.push({ category, amount: e.amount });
    out.push(e);
  }
  return out;
}

/** Entries that are in the sheet's Ledger but not in the app (a multiset difference on the sheet's own row encoding). */
export function newInSheet(sheet: ParsedEntry[], appGroups: { rows: LedgerCell[][] }[], acctIdByName: Map<string, string>, catIdByName: Map<string, string>, acct: Map<string, string>, cat: Map<string, string>): { entry: ParsedEntry; key: string }[] {
  const key = (rows: LedgerCell[][]) => JSON.stringify(rows.map((r) => r.map((v) => (v === "" ? null : v))));
  const have = new Map<string, number>();
  for (const g of appGroups) { const k = key(g.rows); have.set(k, (have.get(k) ?? 0) + 1); }
  const out: { entry: ParsedEntry; key: string }[] = [];
  for (const e of sheet) {
    // encode the sheet entry the way the app would, so the two sides compare like for like
    const accountId = acctIdByName.get(e.account.toLowerCase());
    const asTxn: LedgerTxn = {
      id: "", date: e.date, accountId: accountId ?? `?${e.account}`, payee: e.payee || null, memo: e.memo || null, amount: e.transferTo ? -Math.abs(e.amount) : e.amount,
      transferToAccountId: e.transferTo ? acctIdByName.get(e.transferTo.toLowerCase()) ?? `?${e.transferTo}` : null, sharedFiftyFifty: e.split, hidden: e.hidden,
      lines: e.transferTo ? [] : e.lines.map((l) => ({ categoryId: l.category.toLowerCase() === "ready to assign" ? null : catIdByName.get(l.category.toLowerCase()) ?? `?${l.category}`, amount: l.amount })),
    };
    const acct2 = new Map(acct); const cat2 = new Map(cat);
    for (const id of [asTxn.accountId, asTxn.transferToAccountId]) if (id?.startsWith("?")) acct2.set(id, id.slice(1));
    for (const l of asTxn.lines) if (l.categoryId?.startsWith("?")) cat2.set(l.categoryId, l.categoryId.slice(1));
    const k = key(encodeLedgerGroups([asTxn], acct2, cat2)[0]!.rows);
    const n = have.get(k) ?? 0;
    if (n > 0) { have.set(k, n - 1); continue; }
    out.push({ entry: e, key: k });
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

  // 0. reconcile: entries typed into the sheet's Ledger since the last mirror become app entries first
  let reconciled = 0;
  try {
    const back = await sheets.get(id, `Ledger!F${LEDGER_FIRST}:M${LEDGER_LAST}`, true);
    const parsed = parseLedgerRows(back.map((r) => Array.from({ length: 8 }, (_, i) => r[i] ?? "") as SheetLedgerRow));
    const [txns, lines, accts, cats] = await Promise.all([
      db.select().from(t.transactions).where(isNull(t.transactions.deletedAt)), db.select().from(t.transactionLines), db.select().from(t.accounts), db.select().from(t.categories),
    ]);
    const byTxn = new Map<string, { categoryId: string | null; amount: number; sortOrder: number }[]>();
    for (const l of lines) { const a = byTxn.get(l.transactionId) ?? []; a.push(l); byTxn.set(l.transactionId, a); }
    const acct = new Map(accts.map((a) => [a.id, a.name])), cat = new Map(cats.map((c) => [c.id, c.name]));
    const acctId = new Map(accts.map((a) => [a.name.trim().toLowerCase(), a.id])), catId = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const appGroups = encodeLedgerGroups(txns.map((x) => ({ ...x, lines: (byTxn.get(x.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder) })), acct, cat);
    for (const { entry: e } of newInSheet(parsed, appGroups, acctId, catId, acct, cat)) {
      const accountId = acctId.get(e.account.toLowerCase());
      if (!accountId) { warnings.push(`Sheet row ${usDate(e.date)} ${e.payee || "—"}: unknown account "${e.account}"`); continue; }
      let transferToAccountId: string | null = null;
      const ls: { categoryId: string | null; amount: number }[] = [];
      if (e.transferTo) { transferToAccountId = acctId.get(e.transferTo.toLowerCase()) ?? null; if (!transferToAccountId) { warnings.push(`Sheet row ${usDate(e.date)}: unknown transfer target "${e.transferTo}"`); continue; } }
      else {
        let bad: string | null = null;
        for (const l of e.lines) { const cid = l.category.toLowerCase() === "ready to assign" ? null : catId.get(l.category.toLowerCase()); if (cid === undefined) { bad = l.category; break; } ls.push({ categoryId: cid, amount: l.amount }); }
        if (bad) { warnings.push(`Sheet row ${usDate(e.date)} ${e.payee || "—"}: unknown category "${bad}"`); continue; }
      }
      if (!e.amount && !ls.length) continue;
      await createTransaction(db, me, { date: e.date, accountId, payee: e.payee, memo: e.memo, amount: e.transferTo ? -Math.abs(e.amount) : e.amount, categoryId: ls.length === 1 ? ls[0]!.categoryId : null, lines: ls.length > 1 ? ls : [], transferToAccountId, sharedFiftyFifty: e.split, hidden: e.hidden, trackedAmountId: null, tagIds: [] });
      reconciled++;
    }
  } catch (e) { warnings.push(`Couldn't read the sheet's Ledger back (nothing was overwritten): ${(e as Error).message}`); throw e; }

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

  const result: MirrorResult = { ledgerRows: fit.length, months, moves, inboxAdded: 0, reconciled, backup, warnings, at: new Date().toISOString() };
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

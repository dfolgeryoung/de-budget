/** Load the budget from the database, run the engine, and shape the month for the client. */
import { eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { computeMonth, accountBalance, daysOfBuffer, type BudgetInput, type MonthView } from "../budget/engine.js";
import { addMonths, daysInMonth, type MonthKey } from "../budget/dates.js";

export async function loadBudget(db: Db): Promise<{ input: BudgetInput; names: { accounts: Map<string, string>; categories: Map<string, string> }; groups: typeof t.categoryGroups.$inferSelect[]; cats: typeof t.categories.$inferSelect[]; accts: typeof t.accounts.$inferSelect[] }> {
  const [accts, groups, cats, txns, lines, asgs, goals, first] = await Promise.all([
    db.select().from(t.accounts),
    db.select().from(t.categoryGroups),
    db.select().from(t.categories),
    db.select().from(t.transactions).where(isNull(t.transactions.deletedAt)),
    db.select().from(t.transactionLines),
    db.select().from(t.assignments),
    db.select().from(t.goals),
    db.select().from(t.settings).where(eq(t.settings.key, "first_month")),
  ]);
  const firstMonth = (first[0]?.value as string | undefined) ?? "2026-11-01";
  const linesByTxn = new Map<string, { categoryId: string | null; amount: number }[]>();
  for (const l of lines) {
    const arr = linesByTxn.get(l.transactionId) ?? [];
    arr.push({ categoryId: l.categoryId, amount: l.amount });
    linesByTxn.set(l.transactionId, arr);
  }
  const openingAvailable: Record<string, number> = {};
  for (const c of cats) if (c.openingAvailable) openingAvailable[c.id] = c.openingAvailable;
  const input: BudgetInput = {
    firstMonth,
    openingAvailable,
    accounts: accts.map((a) => ({ id: a.id, type: a.type, onBudget: a.onBudget, owner: a.owner, startingBalance: a.startingBalance, startingDate: a.startingDate })),
    categories: cats.map((c) => ({ id: c.id, groupId: c.groupId, kind: c.kind, accountId: c.accountId, hiddenInBudget: c.hiddenInBudget })),
    transactions: txns.map((x) => ({ id: x.id, date: x.date, accountId: x.accountId, amount: x.amount, transferToAccountId: x.transferToAccountId, sharedFiftyFifty: x.sharedFiftyFifty, confirmed: x.confirmed, payee: x.payee, lines: linesByTxn.get(x.id) ?? [] })),
    assignments: asgs.map((a) => ({ categoryId: a.categoryId, month: a.month, amount: a.amount })),
    goals: goals.map((g) => ({ categoryId: g.categoryId, validFrom: g.validFrom, type: g.type, amount: g.amount, frequencyMonths: g.frequencyMonths, targetDate: g.targetDate })),
  };
  return {
    input,
    names: { accounts: new Map(accts.map((a) => [a.id, a.name])), categories: new Map(cats.map((c) => [c.id, c.name])) },
    groups, cats, accts,
  };
}

export interface MonthPayload {
  month: MonthKey;
  months: MonthKey[];
  view: MonthView;
  groups: { id: string; name: string; system: boolean; categories: string[] }[];
  categories: Record<string, { name: string; emoji: string | null; kind: string; hidden: boolean }>;
  accounts: { id: string; name: string; type: string; onBudget: boolean; balance: number }[];
  daysOfBuffer: number;
  billsToCome: { id: string; payee: string; amount: number; day: number | null; categoryId: string | null }[];
  check: { ok: boolean; diffs: string[]; source: string | null } | null;
}

export async function monthPayload(db: Db, month: MonthKey, today: string): Promise<MonthPayload> {
  const { input, names, groups, cats, accts } = await loadBudget(db);
  const view = computeMonth(input, month);
  const lastDay = `${month.slice(0, 7)}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const months: MonthKey[] = [];
  const end = addMonths(today.slice(0, 7) + "-01", 1);
  for (let m = input.firstMonth; m <= end; m = addMonths(m, 1)) months.push(m);
  if (!months.includes(month)) months.push(month);

  // bills still to come: active recurring bills whose payee has no entry this month
  const recurring = await db.select().from(t.recurring).where(eq(t.recurring.active, true));
  const txnsThisMonth = input.transactions.filter((x) => x.date.slice(0, 7) === month.slice(0, 7));
  const payeesThisMonth = new Set((await db.select({ id: t.transactions.id, payee: t.transactions.payee }).from(t.transactions)).filter((r) => txnsThisMonth.some((x) => x.id === r.id)).map((r) => (r.payee ?? "").toLowerCase()));
  const billsToCome = recurring.filter((r) => !payeesThisMonth.has(r.payee.toLowerCase())).map((r) => ({ id: r.id, payee: r.payee, amount: r.amount, day: r.dayOfMonth, categoryId: r.categoryId }));

  // acceptance check against the sheet's own figures, when an import recorded them
  const expRow = await db.select().from(t.settings).where(eq(t.settings.key, "sheet_expected"));
  const importAt = await db.select().from(t.settings).where(eq(t.settings.key, "import_at"));
  const expSrc = await db.select().from(t.settings).where(eq(t.settings.key, "expected_source"));
  let check: MonthPayload["check"] = null;
  const expected = (expRow[0]?.value as Record<string, { rta: number; available: Record<string, number>; activity: Record<string, number>; accounts: Record<string, number> }> | undefined)?.[month];
  if (expected) {
    const diffs: string[] = [];
    const money = (c: number) => (c < 0 ? "−" : "") + "$" + (Math.abs(c) / 100).toFixed(2);
    if (view.readyToAssign !== expected.rta) diffs.push(`Ready to Assign ${money(view.readyToAssign)} vs sheet ${money(expected.rta)}`);
    if (view.zeroCheck !== 0) diffs.push(`Zero check ${money(view.zeroCheck)}`);
    for (const c of view.categories) {
      const ea = expected.available[c.categoryId], ex = expected.activity[c.categoryId];
      if (ea !== undefined && ea !== c.available) diffs.push(`${names.categories.get(c.categoryId)} available ${money(c.available)} vs sheet ${money(ea)}`);
      if (ex !== undefined && ex !== c.activity) diffs.push(`${names.categories.get(c.categoryId)} activity ${money(c.activity)} vs sheet ${money(ex)}`);
    }
    for (const [id, v] of Object.entries(expected.accounts)) {
      const got = accountBalance(input, id, lastDay);
      if (got !== v) diffs.push(`${names.accounts.get(id)} ${money(got)} vs sheet ${money(v)}`);
    }
    check = { ok: diffs.length === 0, diffs, source: (expSrc[0]?.value as string | undefined) ?? (importAt[0]?.value ? `export imported ${importAt[0].value as string}` : null) };
  }

  return {
    month,
    months,
    view,
    groups: groups.sort((a, b) => a.sortOrder - b.sortOrder).map((g) => ({
      id: g.id, name: g.name, system: g.system,
      categories: cats.filter((c) => c.groupId === g.id).sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.id),
    })),
    categories: Object.fromEntries(cats.map((c) => [c.id, { name: c.name, emoji: c.emoji, kind: c.kind, hidden: c.hiddenInBudget }])),
    accounts: accts.sort((a, b) => a.sortOrder - b.sortOrder).map((a) => ({ id: a.id, name: a.name, type: a.type, onBudget: a.onBudget, balance: accountBalance(input, a.id, today) })),
    daysOfBuffer: daysOfBuffer(input, today),
    billsToCome,
    check,
  };
}

/**
 * One-time migration: load a spreadsheet export into the database.
 * Re-running replaces everything that came from the sheet (source = migration) so the
 * import is repeatable until cut-over; it never touches rows made in the app.
 */
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { parseExport } from "../budget/parseExport.js";
import { layoutFromState, SPLIT_BUCKETS } from "../budget/classicFromState.js";
import { mapState, slug, cents, tabToMonth, type SheetState } from "../budget/fromState.js";
import { monthOf } from "../budget/dates.js";
import { defaultEmoji } from "../budget/emoji.js";

export interface ImportSummary {
  accounts: number; groups: number; categories: number; transactions: number; lines: number;
  assignments: number; goals: number; recurring: number; firstMonth: string; months: string[];
}

export async function importSheetExport(db: Db, text: string, byUserId: string): Promise<ImportSummary> {
  const state = parseExport(text);
  return importState(db, state, byUserId);
}

export async function importState(db: Db, state: SheetState, byUserId: string): Promise<ImportSummary> {
  const m = mapState(state);
  const now = new Date();

  // Until cut-over a re-import resets the budget to the sheet: everything the sheet owns plus any test
  // entries made in the app (they would otherwise pin categories and accounts that are being replaced).
  await db.delete(t.transactions);
  await db.delete(t.payees);
  await db.delete(t.trackedAmounts);
  await db.delete(t.assignments);
  await db.delete(t.goals);
  await db.delete(t.recurring);
  await db.delete(t.categories);
  await db.delete(t.categoryGroups);
  await db.delete(t.accounts);

  // accounts
  const acctRows = state.accounts.map(([name, type, onBudget, starting], i) => ({
    id: m.names.accounts.get(name)!,
    name,
    type: (type === "Checking" ? "checking" : type === "Savings" ? "savings" : "credit_card") as "checking" | "savings" | "credit_card",
    onBudget: onBudget === "Yes",
    owner: (name.startsWith("D ") ? "D" : name.startsWith("E ") ? "E" : "shared") as "D" | "E" | "shared",
    startingBalance: cents(starting),
    startingDate: state.first_month,
    sortOrder: i,
    updatedBy: byUserId,
  }));
  await db.insert(t.accounts).values(acctRows);

  // groups and categories (with Classic defaults filled in later from Settings)
  await db.insert(t.categoryGroups).values(m.groups.map((g) => ({ id: g.id, name: g.name, sortOrder: g.sortOrder, system: g.system, updatedBy: byUserId })));
  const catIn = m.input.categories;
  const pinnedIndex = new Map((state.pinned ?? []).map((n, i) => [n, i]));
  // Classic: the mapping table -> bucket or rule per category; the layout tells which box a bucket line sits in
  const classicRules = new Map((state.classic?.mapping ?? []).map(([name, bucket]) => [name, SPLIT_BUCKETS[bucket] ? { bucket: null, rule: SPLIT_BUCKETS[bucket]! } : { bucket, rule: "none" as const }]));
  const layout = state.classic ? layoutFromState(state) : [];
  const sectionOf = (bucket: string | null): "recurring" | "variable" => (bucket ? layout.find((l) => l.name === bucket || (bucket.endsWith(" Fun Money") && l.name === "Fun Money"))?.section : undefined) ?? "variable";
  const catRows = catIn.map((c, i) => {
    const name = [...m.names.categories].find(([, id]) => id === c.id)![0];
    return {
      id: c.id,
      groupId: c.groupId,
      name,
      emoji: defaultEmoji(name),
      kind: c.kind,
      accountId: c.accountId ?? null,
      openingAvailable: m.input.openingAvailable?.[c.id] ?? 0,
      sortOrder: i,
      favouriteOrder: pinnedIndex.has(name) ? { _: pinnedIndex.get(name)! } : null, // "_" = the shared pin order from the sheet
      classicBucket: classicRules.get(name)?.bucket ?? null,
      classicRule: classicRules.get(name)?.rule ?? "none",
      classicSection: sectionOf(classicRules.get(name)?.bucket ?? null),
      updatedBy: byUserId,
    };
  });
  for (let i = 0; i < catRows.length; i += 50) await db.insert(t.categories).values(catRows.slice(i, i + 50));

  // transactions + lines
  const txnRows = m.input.transactions.map((x) => {
    const e = m.entries.find((e) => e.id === x.id)!;
    return {
      id: x.id,
      date: x.date,
      accountId: x.accountId,
      payee: e.payee || null,
      memo: e.memo || null,
      hidden: e.hidden,
      sharedFiftyFifty: !!x.sharedFiftyFifty,
      transferToAccountId: x.transferToAccountId ?? null,
      amount: x.amount,
      source: "migration" as const,
      createdBy: byUserId,
      updatedBy: byUserId,
    };
  });
  for (let i = 0; i < txnRows.length; i += 50) await db.insert(t.transactions).values(txnRows.slice(i, i + 50));
  const lineRows = m.input.transactions.flatMap((x) =>
    x.lines.map((l, j) => ({ id: `${x.id}-l${j + 1}`, transactionId: x.id, categoryId: l.categoryId, amount: l.amount, sortOrder: j })),
  );
  for (let i = 0; i < lineRows.length; i += 100) await db.insert(t.transactionLines).values(lineRows.slice(i, i + 100));

  // assignments, goals
  const asgRows = m.input.assignments.map((a) => ({ id: `asg-${a.categoryId}-${a.month.slice(0, 7)}`, categoryId: a.categoryId, month: a.month, amount: a.amount, updatedBy: byUserId }));
  for (let i = 0; i < asgRows.length; i += 50) await db.insert(t.assignments).values(asgRows.slice(i, i + 50));
  const goalRows = m.input.goals.map((g) => ({
    id: `goal-${g.categoryId}-${g.validFrom.slice(0, 7)}`, categoryId: g.categoryId, validFrom: g.validFrom, type: g.type, amount: g.amount,
    frequencyMonths: g.frequencyMonths ?? null, targetDate: g.targetDate ?? null, updatedBy: byUserId,
  }));
  for (let i = 0; i < goalRows.length; i += 50) await db.insert(t.goals).values(goalRows.slice(i, i + 50));

  // recurring bills: [payee, account, category, memo, amount, day, active, ...]
  const recRows = (state.recurring ?? []).flatMap((r, i) => {
    const [payee, account, category, memo, amount, day, active] = r;
    const accountId = m.names.accounts.get(account ?? "");
    if (!accountId || !payee) return [];
    return [{
      id: `rec-${slug(payee)}-${i}`,
      payee,
      accountId,
      categoryId: m.names.categories.get(category ?? "") ?? null,
      memo: memo || null,
      amount: -cents(Number(String(amount ?? "0").replace(/[$,]/g, "")) || 0),
      dayOfMonth: day && /^\d+$/.test(day) ? Number(day) : null,
      active: (active ?? "Yes") !== "No",
      sortOrder: i,
      updatedBy: byUserId,
    }];
  });
  if (recRows.length) await db.insert(t.recurring).values(recRows);

  // settings: first month and the sheet's own figures for the acceptance check
  const liveMonths = Object.keys(state.months).map(tabToMonth).sort();
  const put = async (key: string, value: unknown) =>
    db.insert(t.settings).values({ key, value: value as object, updatedAt: now }).onConflictDoUpdate({ target: t.settings.key, set: { value: value as object, updatedAt: now } });
  await put("first_month", monthOf(state.first_month));
  await put("current_month", monthOf(state.current_month));
  await put("sheet_expected", m.expected);
  await put("import_at", now.toISOString());

  // Classic: layout, Internet keywords, typed income per person per month and the typed line budgets of the exported month
  if (state.classic) {
    const c = state.classic;
    await put("classic_layout", layout);
    await put("classic_keywords", c.keywords);
    await put("classic_expected", { month: c.month, layout: c.layout, totals: c.totals ?? {} });
    await db.delete(t.classicMonth);
    const rows: typeof t.classicMonth.$inferInsert[] = [];
    const months = new Set([...Object.keys(c.income), c.month]);
    for (const month of months) {
      const inc = c.income[month];
      for (const owner of ["D", "E", "shared"] as const) {
        const typed: Record<string, number> = {};
        if (month === c.month) for (const l of layout) if (l.typed && l.column === owner) typed[`${l.column}:${l.name}`] = l.defaultBudget;
        const i = owner === "shared" ? null : inc?.[owner];
        if (!i && !Object.keys(typed).length) continue;
        rows.push({ id: `cm-${month}-${owner}`, month, owner, income: cents(i?.[0] ?? 0), incomeActual: cents(i?.[1] ?? 0), typedBudgets: typed, updatedBy: byUserId });
      }
    }
    if (rows.length) await db.insert(t.classicMonth).values(rows);
  }

  return {
    accounts: acctRows.length, groups: m.groups.length, categories: catRows.length, transactions: txnRows.length, lines: lineRows.length,
    assignments: asgRows.length, goals: goalRows.length, recurring: recRows.length, firstMonth: monthOf(state.first_month), months: liveMonths,
  };
}

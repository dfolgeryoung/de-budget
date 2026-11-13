/** The Classic screen: build the engine input from the database and shape the result; typed figures are editable. */
import { eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { computeMonth } from "../budget/engine.js";
import { computeClassic, type ClassicInput, type ClassicLineDef, type ClassicView } from "../budget/classic.js";
import { goalMonthlyAmount } from "../budget/classicFromState.js";
import { loadBudget } from "./month.js";
import type { MonthKey } from "../budget/dates.js";

export interface ClassicPayload extends ClassicView {
  layout: ClassicLineDef[];
  keywords: string[];
  typed: Record<string, number>;
  check: { ok: boolean; diffs: string[]; source: string } | null; // against the exported sheet, only for the month it was exported on
}

async function setting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const r = await db.select().from(t.settings).where(eq(t.settings.key, key));
  return (r[0]?.value as T | undefined) ?? fallback;
}

/** The Classic input for a month (budgets, typed figures and every entry); Reports reuses it for "who spent". */
export async function buildClassicInput(db: Db, month: MonthKey, today: string, me: string): Promise<{ ci: ClassicInput; cmRows: typeof t.classicMonth.$inferSelect[] }> {
  const [{ input, cats }, layout, keywords, cmRows, txns] = await Promise.all([
    loadBudget(db),
    setting<ClassicLineDef[]>(db, "classic_layout", []),
    setting<string[]>(db, "classic_keywords", []),
    db.select().from(t.classicMonth).where(eq(t.classicMonth.month, month)),
    db.select().from(t.transactions).where(isNull(t.transactions.deletedAt)),
  ]);
  const view = computeMonth(input, month);
  const needed: Record<string, number> = {}, goalMonthly: Record<string, number> = {};
  for (const c of view.categories) { needed[c.categoryId] = c.needed; goalMonthly[c.categoryId] = goalMonthlyAmount(c.goal, c.needed); }
  // typed budgets: this month's rows, else the most recent earlier month's, else the layout defaults
  const typed: Record<string, number> = {};
  for (const r of cmRows) Object.assign(typed, r.typedBudgets ?? {});
  if (!Object.keys(typed).length) {
    const prev = (await db.select().from(t.classicMonth)).filter((r) => r.month < month && r.typedBudgets && Object.keys(r.typedBudgets).length).sort((a, b) => (a.month < b.month ? 1 : -1));
    for (const owner of ["shared", "D", "E"]) { const r = prev.find((x) => x.owner === owner); if (r) Object.assign(typed, r.typedBudgets ?? {}); }
  }
  const inc = (owner: "D" | "E") => { const r = cmRows.find((x) => x.owner === owner); return { budget: r?.income ?? 0, actual: r?.incomeActual ?? 0 }; };
  const txMeta = new Map(txns.map((x) => [x.id, x]));
  const ci: ClassicInput = {
    month, today, layout, keywords,
    categories: cats.map((c) => ({ id: c.id, name: c.name, bucket: c.classicBucket, rule: c.classicRule })),
    accounts: input.accounts.map((a) => ({ id: a.id, owner: a.owner })),
    needed, goalMonthly, typed,
    income: { D: inc("D"), E: inc("E") },
    transactions: input.transactions.map((x) => {
      const m = txMeta.get(x.id);
      const masked = !!m?.hidden && m.createdBy !== me;
      return { id: x.id, date: x.date, accountId: x.accountId, payee: m?.payee ?? null, hidden: !!m?.hidden, masked, transferToAccountId: x.transferToAccountId ?? null, sharedFiftyFifty: x.sharedFiftyFifty ?? false, lines: x.lines };
    }),
  };
  return { ci, cmRows };
}

export async function classicPayload(db: Db, month: MonthKey, today: string, me: string): Promise<ClassicPayload> {
  const { ci, cmRows } = await buildClassicInput(db, month, today, me);
  const result = computeClassic(ci);

  // acceptance check against the sheet's own Classic figures for the exported month
  let check: ClassicPayload["check"] = null;
  const expected = await setting<{ month: string; layout: { name: string; column: string; section: string; budget: number; actual: number }[]; source?: string } | null>(db, "classic_expected", null);
  if (expected && expected.month === month) {
    const diffs: string[] = [];
    for (const l of expected.layout) {
      const got = result.lines.find((x) => x.column === l.column && x.name === l.name);
      if (!got) { diffs.push(`${l.column} ${l.name}: missing`); continue; }
      const b = Math.round(l.budget * 100), a = Math.round(l.actual * 100);
      if (got.budget !== b) diffs.push(`${l.column} ${l.name} budget: app ${(got.budget / 100).toFixed(2)} vs sheet ${l.budget.toFixed(2)}`);
      if (got.actual !== a) diffs.push(`${l.column} ${l.name} actual: app ${(got.actual / 100).toFixed(2)} vs sheet ${l.actual.toFixed(2)}`);
    }
    check = { ok: diffs.length === 0, diffs, source: expected.source ?? "the export that was imported" };
  }
  return { ...result, layout: ci.layout, keywords: ci.keywords, typed: ci.typed, check };
}

/** Type a figure: a person's income (budget or actual) or a typed line budget. */
export async function saveClassicTyped(db: Db, month: MonthKey, me: string, body: { owner: "D" | "E" | "shared"; income?: number; incomeActual?: number; typed?: Record<string, number> }) {
  const id = `cm-${month}-${body.owner}`;
  const existing = (await db.select().from(t.classicMonth).where(eq(t.classicMonth.id, id)))[0];
  const typedBudgets = { ...(existing?.typedBudgets ?? {}), ...(body.typed ?? {}) };
  const row = {
    id, month, owner: body.owner,
    income: body.income ?? existing?.income ?? 0,
    incomeActual: body.incomeActual ?? existing?.incomeActual ?? 0,
    typedBudgets, updatedBy: me, updatedAt: new Date(),
  };
  await db.insert(t.classicMonth).values(row).onConflictDoUpdate({ target: t.classicMonth.id, set: { income: row.income, incomeActual: row.incomeActual, typedBudgets, updatedBy: me, updatedAt: row.updatedAt } });
}

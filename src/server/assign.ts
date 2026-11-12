/** Assigning money: set a category's Assigned, move between categories / Ready to Assign, auto-assign, undo. Every change is logged in money_moves. */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as t from "../db/schema.js";
import { loadBudget } from "./month.js";
import { computeMonth, neededThisMonth } from "../budget/engine.js";
import { addMonths, type MonthKey } from "../budget/dates.js";

const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function assigned(db: Db, categoryId: string, month: MonthKey): Promise<number> {
  const r = (await db.select().from(t.assignments).where(and(eq(t.assignments.categoryId, categoryId), eq(t.assignments.month, month))))[0];
  return r?.amount ?? 0;
}
async function setAssigned(db: Db, me: string, categoryId: string, month: MonthKey, amount: number) {
  await db.insert(t.assignments).values({ id: `asg-${categoryId}-${month.slice(0, 7)}`, categoryId, month, amount, updatedBy: me })
    .onConflictDoUpdate({ target: [t.assignments.categoryId, t.assignments.month], set: { amount, updatedBy: me, updatedAt: new Date() } });
}

/** Move `amount` cents from one place to another (null = Ready to Assign). Returns the move id for undo. */
export async function move(db: Db, me: string, month: MonthKey, from: string | null, to: string | null, amount: number, how: "move" | "spread" | "auto_assign" | "typed" | "release" | "reset" = "move") {
  if (amount === 0 || from === to) return null;
  if (from) await setAssigned(db, me, from, month, (await assigned(db, from, month)) - amount);
  if (to) await setAssigned(db, me, to, month, (await assigned(db, to, month)) + amount);
  const id = newId("mv");
  await db.insert(t.moneyMoves).values({ id, month, fromCategoryId: from, toCategoryId: to, amount, how, byUserId: me });
  return id;
}

/** Type a new Assigned value for a category: the difference comes from / goes to Ready to Assign. */
export async function typeAssigned(db: Db, me: string, month: MonthKey, categoryId: string, amount: number) {
  const cur = await assigned(db, categoryId, month);
  const delta = amount - cur;
  if (delta > 0) return move(db, me, month, null, categoryId, delta, "typed");
  if (delta < 0) return move(db, me, month, categoryId, null, -delta, "typed");
  return null;
}

export async function undoMove(db: Db, me: string, moveId: string) {
  const mv = (await db.select().from(t.moneyMoves).where(eq(t.moneyMoves.id, moveId)))[0];
  if (!mv || mv.undone) return;
  if (mv.fromCategoryId) await setAssigned(db, me, mv.fromCategoryId, mv.month, (await assigned(db, mv.fromCategoryId, mv.month)) + mv.amount);
  if (mv.toCategoryId) await setAssigned(db, me, mv.toCategoryId, mv.month, (await assigned(db, mv.toCategoryId, mv.month)) - mv.amount);
  await db.update(t.moneyMoves).set({ undone: true }).where(eq(t.moneyMoves.id, moveId));
}

export async function recentMoves(db: Db, month: MonthKey, limit = 30) {
  const rows = await db.select().from(t.moneyMoves).where(eq(t.moneyMoves.month, month)).orderBy(desc(t.moneyMoves.at)).limit(limit);
  return rows;
}

/** Auto-assign options (YNAB's set). `only` limits to selected categories; otherwise the whole plan minus hidden. */
export async function autoAssign(db: Db, me: string, month: MonthKey, option: "underfunded" | "assigned_last_month" | "spent_last_month" | "average_assigned" | "average_spent" | "reduce_overfunding" | "reset_available" | "reset_assigned", only?: string[]) {
  const { input, cats } = await loadBudget(db);
  const view = computeMonth(input, month);
  const targets = view.categories.filter((c) => {
    const meta = cats.find((x) => x.id === c.categoryId);
    if (!meta || meta.kind === "next_month" || meta.kind === "card_payment") return false;
    return only?.length ? only.includes(c.categoryId) : !meta.hiddenInBudget;
  });
  const ids: string[] = [];
  const prev = addMonths(month, -1);
  const lastView = computeMonth(input, prev);
  const months12 = Array.from({ length: 12 }, (_, i) => addMonths(month, -(i + 1))).filter((m) => m >= input.firstMonth);
  const views12 = months12.map((m) => computeMonth(input, m));
  let rta = view.readyToAssign;
  for (const c of targets) {
    let target = c.assigned;
    switch (option) {
      case "underfunded": {
        const want = c.assigned + c.short + Math.max(0, -c.available);
        target = Math.max(c.assigned, want);
        break;
      }
      case "assigned_last_month": target = lastView.categories.find((x) => x.categoryId === c.categoryId)?.assigned ?? 0; break;
      case "spent_last_month": target = -(lastView.categories.find((x) => x.categoryId === c.categoryId)?.activity ?? 0); break;
      case "average_assigned": {
        const vals = views12.map((v) => v.categories.find((x) => x.categoryId === c.categoryId)?.assigned ?? 0);
        const firstIdx = vals.findIndex((v) => v !== 0);
        const used = firstIdx >= 0 ? vals.slice(0, vals.length - (vals.length - 1 - vals.map((v) => v !== 0).lastIndexOf(true))) : [];
        target = used.length ? Math.round(used.reduce((s, v) => s + v, 0) / used.length) : c.assigned;
        break;
      }
      case "average_spent": {
        const vals = views12.map((v) => -(v.categories.find((x) => x.categoryId === c.categoryId)?.activity ?? 0));
        const used = vals.slice(0, vals.map((v) => v !== 0).lastIndexOf(true) + 1);
        target = used.length ? Math.round(used.reduce((s, v) => s + v, 0) / used.length) : c.assigned;
        break;
      }
      case "reduce_overfunding": {
        const goalAmt = c.goal ? neededThisMonth(c.goal, c.carriedIn, c.available, month) : 0;
        if (c.goal && c.assigned > goalAmt && c.available > 0) target = Math.max(goalAmt, c.assigned - c.available);
        break;
      }
      case "reset_available": target = c.assigned - c.available; break;
      case "reset_assigned": target = 0; break;
    }
    let delta = target - c.assigned;
    if (delta > 0 && option !== "reset_available") delta = Math.min(delta, Math.max(0, rta)); // never assign more than is ready
    if (delta === 0) continue;
    rta -= delta;
    const id = await move(db, me, month, delta > 0 ? null : c.categoryId, delta > 0 ? c.categoryId : null, Math.abs(delta), option === "reset_assigned" || option === "reset_available" ? "reset" : "auto_assign");
    if (id) ids.push(id);
  }
  return ids;
}

/** Category history for the panel: last month, 12-month averages, spending vs last month. */
export async function categoryHistory(db: Db, categoryId: string, month: MonthKey) {
  const { input } = await loadBudget(db);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(month, -(i + 1))).filter((m) => m >= input.firstMonth);
  const rows = months.map((m) => { const v = computeMonth(input, m).categories.find((c) => c.categoryId === categoryId); return { month: m, assigned: v?.assigned ?? 0, activity: v?.activity ?? 0, available: v?.available ?? 0 }; });
  const avg = (k: "assigned" | "activity") => (rows.length ? Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length) : 0);
  return { months: rows, averageAssigned: avg("assigned"), averageSpent: -avg("activity") };
}

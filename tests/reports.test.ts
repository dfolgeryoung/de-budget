import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { computeReports, spendByCategory, spendByOwner } from "../src/budget/reports";
import { mapState, type SheetState } from "../src/budget/fromState";
import { computeMonth, type BudgetInput } from "../src/budget/engine";

const state = JSON.parse(readFileSync(new URL("./fixtures/state-scrubbed.json", import.meta.url), "utf8")) as SheetState;
const m = mapState(state);
const idToName = new Map([...m.names.categories].map(([n, id]) => [id, n]));
const categories = m.input.categories.map((c) => ({ id: c.id, name: idToName.get(c.id) ?? c.id, emoji: null, kind: c.kind }));
const month = state.current_month;
const today = "2026-11-11";
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("reports on the spreadsheet export", () => {
  const r = computeReports({ input: m.input, categories, recurring: [], month, today });

  it("counts the days and labels the month", () => {
    expect(r.daysElapsed).toBe(11);
    expect(r.daysInMonth).toBe(30);
    expect(r.daysLeft).toBe(19);
    expect(r.isCurrent).toBe(true);
    expect(r.prevMonth).toBe("2026-10-01");
  });

  it("spent so far equals the month's spending activity in spending categories", () => {
    const view = computeMonth(m.input, month);
    const spendKinds = new Set(m.input.categories.filter((c) => c.kind === "normal" || c.kind === "next_month").map((c) => c.id));
    const activity = -sum(view.categories.filter((c) => spendKinds.has(c.categoryId)).map((c) => c.activity));
    expect(r.thisMonth.spent).toBe(activity);
    expect(r.thisMonth.budgeted).toBeGreaterThanOrEqual(sum(view.categories.filter((c) => spendKinds.has(c.categoryId)).map((c) => Math.max(0, c.assigned))));
    expect(sum(r.thisMonth.byCategory.map((c) => c.spent))).toBe(r.thisMonth.spent);
  });

  it("who-spent shares add up to the total", () => {
    expect(sum(r.thisMonth.byOwner.map((o) => o.spent))).toBe(r.thisMonth.spent);
    expect(Math.round(sum(r.thisMonth.byOwner.map((o) => o.share)) * 1000)).toBe(1000);
  });

  it("the explanation rows reproduce the headline numbers", () => {
    const spentRow = r.thisMonth.explain.spent.rows.find((x) => x.result)!;
    expect(spentRow.v).toBe(r.thisMonth.spent);
    const pace = r.thisMonth.explain.onPace.rows;
    expect(pace.find((x) => x.k === "On pace to spend")!.v).toBe(r.thisMonth.onPace);
    expect(r.thisMonth.onPace).toBeGreaterThanOrEqual(r.thisMonth.spent);
  });

  it("trends end with the current month and include its income", () => {
    const last = r.trends.months[r.trends.months.length - 1]!;
    expect(last.month).toBe(month);
    expect(r.trends.months.length).toBe(1); // the export's ledger starts in November
    expect(r.trends.categories.length).toBeLessThanOrEqual(8);
  });
});

describe("pacing with bills", () => {
  const input: BudgetInput = {
    firstMonth: "2026-11-01",
    accounts: [{ id: "d", type: "checking", onBudget: true, owner: "D", startingBalance: 100000, startingDate: "2026-11-01" }, { id: "e", type: "checking", onBudget: true, owner: "E", startingBalance: 100000, startingDate: "2026-11-01" }],
    categories: [{ id: "groc", groupId: "g", kind: "normal" }, { id: "rent", groupId: "g", kind: "normal" }, { id: "car", groupId: "g", kind: "normal" }],
    transactions: [
      { id: "1", date: "2026-11-02", accountId: "d", amount: -10000, sharedFiftyFifty: true, payee: "Store", lines: [{ categoryId: "groc", amount: -10000 }] },
      { id: "2", date: "2026-11-05", accountId: "e", amount: -2500, payee: "Store", lines: [{ categoryId: "groc", amount: -2500 }] },
      { id: "2b", date: "2026-11-08", accountId: "e", amount: -2500, payee: "Store", lines: [{ categoryId: "groc", amount: -2500 }] },
      { id: "5", date: "2026-11-03", accountId: "d", amount: -60000, payee: "Mechanic", lines: [{ categoryId: "car", amount: -60000 }] },
      { id: "3", date: "2026-11-01", accountId: "d", amount: -100000, payee: "Landlord", lines: [{ categoryId: "rent", amount: -100000 }] },
      { id: "4", date: "2026-11-20", accountId: "d", amount: -99900, payee: "Future", lines: [{ categoryId: "groc", amount: -99900 }] },
    ],
    assignments: [{ categoryId: "groc", month: "2026-11-01", amount: 40000 }, { categoryId: "rent", month: "2026-11-01", amount: 100000 }, { categoryId: "car", month: "2026-11-01", amount: 30000 }],
    goals: [],
  };
  const cats = [{ id: "groc", name: "Groceries", emoji: "🛒", kind: "normal" }, { id: "rent", name: "Rent", emoji: "🏠", kind: "normal" }, { id: "car", name: "Car repairs", emoji: null, kind: "normal" }];
  const recurring = [{ id: "r1", payee: "Landlord", amount: -100000, day: 1, categoryId: "rent" }, { id: "r2", payee: "Water", amount: -3000, day: 25, categoryId: "rent" }];
  const r = computeReports({ input, categories: cats, recurring, month: "2026-11-01", today: "2026-11-10" });

  it("only counts entries through today", () => {
    expect(r.thisMonth.spent).toBe(175000);
    expect(spendByCategory(input, "2026-11-01", "2026-11-10").get("groc")).toBe(15000);
  });
  it("splits a 50/50 entry between the two of you", () => {
    expect(spendByOwner(input, "2026-11-01", "2026-11-10")).toEqual({ shared: 0, D: 165000, E: 10000 });
  });
  it("bills to come are the recurring payees not yet entered", () => {
    expect(r.thisMonth.billsToCome.map((b) => b.payee)).toEqual(["Water"]);
    expect(r.thisMonth.billsTotal).toBe(3000);
  });
  it("on pace = spent + bills to come + everyday rate × days left; a one-off is not extrapolated", () => {
    // groceries (three entries) = 15000 over 10 days = 1500/day × 20 days left = 30000; the car repair stays at 60000
    expect(r.thisMonth.onPace).toBe(175000 + 3000 + 30000);
    const car = r.projection.categories.find((c) => c.id === "car")!;
    expect(car.how).toBe("one-off");
    expect(car.projected).toBe(60000);
  });
  it("a one-off that is still under its budget is assumed to spend the budget", () => {
    const small = computeReports({ input: { ...input, transactions: input.transactions.map((t) => (t.id === "5" ? { ...t, amount: -10000, lines: [{ categoryId: "car", amount: -10000 }] } : t)) }, categories: cats, recurring, month: "2026-11-01", today: "2026-11-10" });
    expect(small.projection.categories.find((c) => c.id === "car")!.projected).toBe(30000);
  });
  it("projection flags the category heading over", () => {
    const groc = r.projection.categories.find((c) => c.id === "groc")!;
    expect(groc.projected).toBe(45000);
    expect(groc.over).toBe(5000);
    const rent = r.projection.categories.find((c) => c.id === "rent")!;
    expect(rent.isBills).toBe(true);
    expect(rent.projected).toBe(103000);
    expect(r.projection.headingOver.map((c) => c.id)).toEqual(["car", "groc", "rent"]);
  });
});

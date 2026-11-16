import { describe, it, expect } from "vitest";
import { computeMonth, diagnoseZeroCheck, type BudgetInput } from "../src/budget/engine";

const base: BudgetInput = {
  firstMonth: "2026-11-01",
  accounts: [
    { id: "e", type: "checking", onBudget: true, owner: "E", startingBalance: 100000, startingDate: "2026-11-01" },
    { id: "cap", type: "credit_card", onBudget: true, owner: "shared", startingBalance: 0, startingDate: "2026-11-01" },
    { id: "sav", type: "savings", onBudget: false, owner: "shared", startingBalance: 50000, startingDate: "2026-11-01" },
  ],
  categories: [{ id: "house", groupId: "g", kind: "normal" }, { id: "fun", groupId: "g", kind: "normal" }, { id: "cappay", groupId: "g", kind: "card_payment", accountId: "cap" }],
  transactions: [{ id: "buy", date: "2026-11-03", accountId: "cap", amount: -5000, payee: "Target", lines: [{ categoryId: "house", amount: -5000 }] }],
  assignments: [{ categoryId: "house", month: "2026-11-01", amount: 10000 }],
  goals: [],
};

describe("zero check diagnosis", () => {
  it("a clean budget has nothing to explain", () => {
    const d = diagnoseZeroCheck(base, "2026-11-01");
    expect(d.zeroCheck).toBe(0); expect(d.causes).toEqual([]); expect(d.unexplained).toBe(0);
  });
  it("an uncategorised refund on a card explains the whole gap", () => {
    const input = { ...base, transactions: [...base.transactions, { id: "refund", date: "2026-11-10", accountId: "cap", amount: 1286, payee: "Target", lines: [{ categoryId: null, amount: 1286 }] }] };
    expect(computeMonth(input, "2026-11-01").zeroCheck).toBe(-1286);
    const d = diagnoseZeroCheck(input, "2026-11-01");
    expect(d.causes.map((c) => [c.kind, c.transactionId, c.effect])).toEqual([["card_uncategorized", "refund", -1286]]);
    expect(d.unexplained).toBe(0);
  });
  it("the same refund with a category is fine", () => {
    const input = { ...base, transactions: [...base.transactions, { id: "refund", date: "2026-11-10", accountId: "cap", amount: 1286, payee: "Target", lines: [{ categoryId: "house", amount: 1286 }] }] };
    expect(diagnoseZeroCheck(input, "2026-11-01").zeroCheck).toBe(0);
  });
  it("a categorised entry on an off-budget account, and a split that doesn't add up", () => {
    const input = { ...base, transactions: [...base.transactions,
      { id: "off", date: "2026-11-05", accountId: "sav", amount: -2000, payee: "Bank", lines: [{ categoryId: "fun", amount: -2000 }] },
      { id: "split", date: "2026-11-06", accountId: "e", amount: -3000, payee: "Store", lines: [{ categoryId: "fun", amount: -1000 }, { categoryId: "house", amount: -1500 }] },
    ] };
    const d = diagnoseZeroCheck(input, "2026-11-01");
    expect(d.causes.map((c) => [c.kind, c.effect])).toEqual([["off_budget_categorized", 2000], ["lines_mismatch", -500]]);
    expect(d.causes.reduce((s, c) => s + c.effect, 0)).toBe(d.zeroCheck);
    expect(d.unexplained).toBe(0);
  });
});

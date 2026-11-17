import { describe, it, expect } from "vitest";
import { computeSavings } from "../src/budget/savings";
import type { BudgetInput } from "../src/budget/engine";

const input: BudgetInput = {
  firstMonth: "2026-10-01",
  accounts: [{ id: "d", type: "checking", onBudget: true, owner: "D", startingBalance: 500000, startingDate: "2026-10-01" }, { id: "mm", type: "savings", onBudget: true, owner: "shared", startingBalance: 0, startingDate: "2026-10-01" }],
  categories: [{ id: "groc", groupId: "g", kind: "normal" }, { id: "ret", groupId: "g", kind: "normal" }, { id: "nm", groupId: "g", kind: "next_month" }],
  transactions: [
    { id: "p1", date: "2026-10-05", accountId: "d", amount: 400000, payee: "Pay", lines: [{ categoryId: null, amount: 400000 }] },
    { id: "g1", date: "2026-10-10", accountId: "d", amount: -100000, payee: "Store", lines: [{ categoryId: "groc", amount: -100000 }] },
    { id: "r1", date: "2026-10-15", accountId: "d", amount: -15000, payee: "SECU", lines: [{ categoryId: "ret", amount: -15000 }] },
    { id: "t1", date: "2026-10-20", accountId: "d", amount: -200000, transferToAccountId: "mm", payee: null, lines: [] },
    { id: "p2", date: "2026-11-05", accountId: "d", amount: 400000, payee: "Pay", lines: [{ categoryId: null, amount: 400000 }] },
    { id: "g2", date: "2026-11-08", accountId: "d", amount: -50000, payee: "Store", lines: [{ categoryId: "groc", amount: -50000 }] },
    { id: "g3", date: "2026-11-25", accountId: "d", amount: -50000, payee: "Store", lines: [{ categoryId: "groc", amount: -50000 }] },
    { id: "i1", date: "2026-11-10", accountId: "mm", amount: 41022, payee: "Interest", lines: [{ categoryId: null, amount: 41022 }] },
  ],
  assignments: [], goals: [],
};
const cats = [{ id: "groc", name: "Groceries" }, { id: "ret", name: "Elizabeth SECU Retirement" }, { id: "nm", name: "Next Month's Money" }];

describe("savings by month", () => {
  const v = computeSavings(input, cats, "2026-11-17");
  it("put away = income − spending, contributions aside; transfers between on-budget accounts don't count", () => {
    const oct = v.months[0]!;
    expect(oct).toMatchObject({ month: "2026-10-01", partial: false, income: 400000, spending: 100000, contributions: 15000, putAway: 300000, leftover: 285000, running: 300000 });
    expect(oct.contributionLines).toEqual([{ id: "ret", name: "Elizabeth SECU Retirement", amount: 15000 }]);
  });
  it("the current month stops at today and counts on-budget interest as income", () => {
    const nov = v.months[1]!;
    expect(nov.partial).toBe(true);
    expect(nov.income).toBe(441022);
    expect(nov.spending).toBe(50000); // the Nov 25 entry is still ahead
    expect(nov.running).toBe(300000 + 391022);
  });
  it("averages over full months only", () => {
    expect(v.avgPutAway).toBe(300000);
  });
});

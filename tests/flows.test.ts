import { describe, it, expect } from "vitest";
import { computeFlows } from "../src/budget/flows";
import type { BudgetInput } from "../src/budget/engine";

const input: BudgetInput = {
  firstMonth: "2026-11-01",
  accounts: [{ id: "d", type: "checking", onBudget: true, owner: "D", startingBalance: 100000, startingDate: "2026-11-01" }, { id: "sav", type: "savings", onBudget: false, owner: "shared", startingBalance: 0, startingDate: "2026-11-01" }],
  categories: [{ id: "groc", groupId: "g1", kind: "normal" }, { id: "fun", groupId: "g2", kind: "normal" }, { id: "ret", groupId: "g3", kind: "normal" }],
  transactions: [
    { id: "p", date: "2026-11-05", accountId: "d", amount: 300000, payee: "WEKA", lines: [{ categoryId: null, amount: 300000 }] },
    { id: "p2", date: "2026-11-06", accountId: "d", amount: 50000, payee: "SketchDeck", lines: [{ categoryId: null, amount: 50000 }] },
    { id: "x", date: "2026-11-07", accountId: "sav", amount: 41022, payee: "Interest", lines: [{ categoryId: null, amount: 41022 }] },
    { id: "g", date: "2026-11-08", accountId: "d", amount: -120000, payee: "Store", lines: [{ categoryId: "groc", amount: -120000 }] },
    { id: "f", date: "2026-11-09", accountId: "d", amount: -30000, payee: "Bar", lines: [{ categoryId: "fun", amount: -30000 }] },
    { id: "r", date: "2026-11-10", accountId: "d", amount: -20000, payee: "SECU", lines: [{ categoryId: "ret", amount: -20000 }] },
    { id: "t", date: "2026-11-11", accountId: "d", amount: -50000, transferToAccountId: "sav", payee: null, lines: [] },
  ],
  assignments: [], goals: [],
};
const cats = [{ id: "groc", name: "Groceries", groupId: "g1" }, { id: "fun", name: "David Fun Money", groupId: "g2" }, { id: "ret", name: "SECU Retirement", groupId: "g3" }];
const groups = [{ id: "g1", name: "Household" }, { id: "g2", name: "Personal" }, { id: "g3", name: "Savings" }];

describe("money flows", () => {
  const f = computeFlows(input, "2026-11-01", null, cats, groups);
  it("income by payee feeds the groups, contributions and what's left", () => {
    expect(f.income).toBe(350000); // off-budget interest and the transfer don't count
    expect(f.nodes.filter((n) => n.kind === "source").map((n) => [n.name, n.amount])).toEqual([["WEKA", 300000], ["SketchDeck", 50000]]);
    expect(f.nodes.filter((n) => n.kind === "group").map((n) => [n.name, n.amount])).toEqual([["Household", 120000], ["Personal", 30000]]);
    expect(f.contributions).toBe(20000);
    expect(f.saved).toBe(350000 - 150000 - 20000);
    const outOfIncome = f.links.filter((l) => l.from === "income").reduce((s, l) => s + l.amount, 0);
    const intoIncome = f.links.filter((l) => l.to === "income").reduce((s, l) => s + l.amount, 0);
    expect(outOfIncome).toBe(intoIncome);
  });
  it("a month that outspends income draws the difference from earlier months", () => {
    const lean = computeFlows({ ...input, transactions: input.transactions.filter((t) => t.id !== "p") }, "2026-11-01", null, cats, groups);
    expect(lean.shortfall).toBe(120000);
    expect(lean.nodes.find((n) => n.kind === "carry")?.amount).toBe(120000);
    expect(lean.saved).toBe(0);
  });
});

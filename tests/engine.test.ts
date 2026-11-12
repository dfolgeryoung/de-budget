import { describe, it, expect } from "vitest";
import { computeMonth, daysOfBuffer, weeklyAllowance, type BudgetInput } from "../src/budget/engine";
import { parseMoney, formatMoney } from "../src/budget/money";
import { parseTypedDate } from "../src/budget/dates";

const base: BudgetInput = {
  firstMonth: "2026-11-01",
  accounts: [
    { id: "dchk", type: "checking", onBudget: true, owner: "D", startingBalance: 100000, startingDate: "2026-11-01" },
    { id: "cap", type: "credit_card", onBudget: true, owner: "shared", startingBalance: 0, startingDate: "2026-11-01" },
  ],
  categories: [
    { id: "groc", groupId: "living", kind: "normal" },
    { id: "gas", groupId: "living", kind: "normal" },
    { id: "cap_pay", groupId: "cards", kind: "card_payment", accountId: "cap" },
  ],
  transactions: [],
  assignments: [{ categoryId: "groc", month: "2026-11-01", amount: 30000 }],
  goals: [{ categoryId: "groc", validFrom: "2026-11-01", type: "refill_to", amount: 50000, frequencyMonths: 1 }],
};

describe("zero-based identity", () => {
  it("cash on budget = sum available + RTA, with no transactions", () => {
    const v = computeMonth(base, "2026-11-01");
    expect(v.readyToAssign).toBe(70000);
    expect(v.zeroCheck).toBe(0);
  });

  it("a card purchase moves money from the category to the card payment category", () => {
    const input: BudgetInput = {
      ...base,
      transactions: [
        { id: "t1", date: "2026-11-08", accountId: "cap", amount: -7515, lines: [{ categoryId: "groc", amount: -7515 }] },
      ],
    };
    const v = computeMonth(input, "2026-11-01");
    const groc = v.categories.find((c) => c.categoryId === "groc")!;
    const pay = v.categories.find((c) => c.categoryId === "cap_pay")!;
    expect(groc.available).toBe(30000 - 7515);
    expect(pay.available).toBe(7515);
    expect(v.owedOnCards).toBe(7515);
    expect(v.setAsideForCards).toBe(7515);
    expect(v.uncoveredCardDebt).toBe(0);
    expect(v.zeroCheck).toBe(0);
  });

  it("paying the card is a transfer that lowers set-aside and the card balance together", () => {
    const input: BudgetInput = {
      ...base,
      transactions: [
        { id: "t1", date: "2026-11-08", accountId: "cap", amount: -7515, lines: [{ categoryId: "groc", amount: -7515 }] },
        { id: "t2", date: "2026-11-09", accountId: "dchk", amount: -7515, transferToAccountId: "cap", lines: [] },
      ],
    };
    const v = computeMonth(input, "2026-11-01");
    expect(v.categories.find((c) => c.categoryId === "cap_pay")!.available).toBe(0);
    expect(v.owedOnCards).toBe(0);
    expect(v.zeroCheck).toBe(0);
  });

  it("overspending carries into next month as a negative available, RTA unchanged (the sheet's rule)", () => {
    const input: BudgetInput = {
      ...base,
      transactions: [{ id: "t1", date: "2026-11-20", accountId: "dchk", amount: -1000, lines: [{ categoryId: "gas", amount: -1000 }] }],
    };
    const nov = computeMonth(input, "2026-11-01");
    expect(nov.categories.find((c) => c.categoryId === "gas")!.status).toBe("overspent");
    const dec = computeMonth(input, "2026-12-01");
    expect(dec.categories.find((c) => c.categoryId === "gas")!.carriedIn).toBe(-1000);
    expect(dec.readyToAssign).toBe(70000);
    expect(dec.zeroCheck).toBe(0);
  });
});

describe("first month", () => {
  it("starting RTA is starting cash minus what the history already had in categories", () => {
    const v = computeMonth({ ...base, openingAvailable: { groc: 10000, gas: 5000 } }, "2026-11-01");
    expect(v.readyToAssign).toBe(100000 - 15000 - 30000);
    expect(v.categories.find((c) => c.categoryId === "groc")!.carriedIn).toBe(10000);
    expect(v.zeroCheck).toBe(0);
  });
});

describe("goals", () => {
  it("refill_to needs the gap to the goal and reports the shortfall", () => {
    const v = computeMonth(base, "2026-11-01");
    const groc = v.categories.find((c) => c.categoryId === "groc")!;
    expect(groc.needed).toBe(50000);
    expect(groc.short).toBe(20000);
    expect(groc.status).toBe("underfunded");
  });
});

describe("helpers", () => {
  it("money parses and formats", () => {
    expect(parseMoney("$1,300.00")).toBe(130000);
    expect(parseMoney("-18.35")).toBe(-1835);
    expect(parseMoney("(5)")).toBe(-500);
    expect(parseMoney("abc")).toBeNull();
    expect(formatMoney(-1835)).toBe("−$18.35");
    expect(formatMoney(130000)).toBe("$1,300.00");
  });
  it("typed dates standardise", () => {
    const t = "2026-11-11";
    expect(parseTypedDate("11/11", t)).toBe("2026-11-11");
    expect(parseTypedDate("11.11", t)).toBe("2026-11-11");
    expect(parseTypedDate("November 11", t)).toBe("2026-11-11");
    expect(parseTypedDate("nov 8", t)).toBe("2026-11-08");
    expect(parseTypedDate("8", t)).toBe("2026-11-08");
    expect(parseTypedDate("y", t)).toBe("2026-11-10");
    expect(parseTypedDate("12/28", "2027-01-03")).toBe("2026-12-28");
    expect(parseTypedDate("13/40", t)).toBeNull();
  });
  it("weekly allowance uses days left including today", () => {
    expect(weeklyAllowance(43642, "2026-11-11")).toEqual({ perWeek: 15275, weeksLeft: 2.9 });
  });
  it("days of buffer", () => {
    const input: BudgetInput = {
      ...base,
      transactions: [{ id: "t1", date: "2026-11-05", accountId: "dchk", amount: -30000, lines: [{ categoryId: "groc", amount: -30000 }] }],
    };
    expect(daysOfBuffer(input, "2026-11-11")).toBe(70);
  });
});

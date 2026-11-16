import { describe, it, expect } from "vitest";
import { pairUp, pairKey, type DupEntry } from "../src/server/duplicates";

const e = (id: string, date: string, payee: string, amount: number): DupEntry => ({ id, date, payee, memo: null, amount, account: "D Checking", category: null, enteredBy: null, createdAt: "2026-11-15T00:00:00Z" });

describe("possible duplicates", () => {
  it("pairs same payee and amount within 3 days, case-insensitively", () => {
    const pairs = pairUp([e("1", "2026-11-14", "Alamo Drafthouse", -1339), e("2", "2026-11-16", "alamo drafthouse", -1339), e("3", "2026-11-14", "Alamo Drafthouse", -2500)], new Set());
    expect(pairs.map((p) => [p.a.id, p.b.id])).toEqual([["1", "2"]]);
  });
  it("ignores entries more than 3 days apart and dismissed pairs", () => {
    expect(pairUp([e("1", "2026-11-10", "Netflix", -1599), e("2", "2026-11-14", "Netflix", -1599)], new Set())).toEqual([]);
    expect(pairUp([e("1", "2026-11-13", "Netflix", -1599), e("2", "2026-11-14", "Netflix", -1599)], new Set([pairKey("2", "1")]))).toEqual([]);
  });
  it("three alike entries make three pairs", () => {
    expect(pairUp([e("1", "2026-11-14", "Coffee", -400), e("2", "2026-11-14", "Coffee", -400), e("3", "2026-11-15", "Coffee", -400)], new Set()).length).toBe(3);
  });
});

/**
 * Acceptance: the app reproduces the spreadsheet's Ready to Assign, every category's
 * Available and Activity, and every account balance, to the cent, for each live month.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { mapState, type SheetState } from "../src/budget/fromState";
import { computeMonth, accountBalance } from "../src/budget/engine";
import { formatMoney } from "../src/budget/money";
import { daysInMonth } from "../src/budget/dates";

// state-scrubbed.json is the 2026-11-11 export with payees and memos replaced (amounts, categories and
// balances intact), so the maths is proven on every build without the real names travelling with the repo.
// A real export (state-2026-*.json, git-ignored) is used instead when present.
const real = new URL("./fixtures/state-2026-11-11.json", import.meta.url);
const fixture = existsSync(real) ? real : new URL("./fixtures/state-scrubbed.json", import.meta.url);
const state = existsSync(fixture) ? (JSON.parse(readFileSync(fixture, "utf8")) as SheetState) : null;
const mapped = state ? mapState(state) : null;
describe.skipIf(!mapped)("acceptance fixture present", () => { it("is mapped", () => expect(mapped).not.toBeNull()); });
if (mapped) {
const catName = new Map([...mapped.names.categories].map(([n, id]) => [id, n]));
const acctName = new Map([...mapped.names.accounts].map(([n, id]) => [id, n]));

for (const [month, exp] of Object.entries(mapped.expected)) {
  describe(`${month} matches the sheet`, () => {
    const view = computeMonth(mapped.input, month);
    it("Ready to Assign", () => expect(formatMoney(view.readyToAssign)).toBe(formatMoney(exp.rta)));
    it("zero check", () => expect(view.zeroCheck).toBe(0));
    it("every category's Available and Activity", () => {
      const diffs: string[] = [];
      for (const c of view.categories) {
        const ea = exp.available[c.categoryId], ex = exp.activity[c.categoryId];
        if (ea !== undefined && ea !== c.available) diffs.push(`${catName.get(c.categoryId)} available ${formatMoney(c.available)} vs sheet ${formatMoney(ea)}`);
        if (ex !== undefined && ex !== c.activity) diffs.push(`${catName.get(c.categoryId)} activity ${formatMoney(c.activity)} vs sheet ${formatMoney(ex)}`);
      }
      expect(diffs).toEqual([]);
    });
    it("every account balance", () => {
      const lastDay = `${month.slice(0, 7)}-${String(daysInMonth(month)).padStart(2, "0")}`;
      const diffs: string[] = [];
      for (const [id, v] of Object.entries(exp.accounts)) {
        const got = accountBalance(mapped.input, id, lastDay);
        if (got !== v) diffs.push(`${acctName.get(id)} ${formatMoney(got)} vs sheet ${formatMoney(v)}`);
      }
      expect(diffs).toEqual([]);
    });
  });
}
}

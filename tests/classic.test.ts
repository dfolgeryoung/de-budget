import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { computeClassic } from "../src/budget/classic";
import { classicInputFromState } from "../src/budget/classicFromState";
import type { SheetState } from "../src/budget/fromState";

const real = new URL("./fixtures/state-2026-11-11.json", import.meta.url);
const file = existsSync(real) ? real : new URL("./fixtures/state-scrubbed.json", import.meta.url);
const state = JSON.parse(readFileSync(file, "utf8")) as SheetState;
const c = state.classic!;
const $ = (x: number) => Math.round(x * 100);

describe("classic tab matches the spreadsheet", () => {
  const view = computeClassic(classicInputFromState(state, c.month, "2026-11-11")); // export taken on the 11th: 11 days elapsed, 19 left
  const line = (column: string, name: string) => view.lines.find((l) => l.column === column && l.name === name)!;

  it("every line's budget and actual", () => {
    const diffs: string[] = [];
    for (const l of c.layout) {
      const got = line(l.column, l.name);
      if (!got) { diffs.push(`${l.column}:${l.name} missing`); continue; }
      if (got.budget !== $(l.budget)) diffs.push(`${l.column}:${l.name} budget ${got.budget} vs ${$(l.budget)}`);
      if (got.actual !== $(l.actual)) diffs.push(`${l.column}:${l.name} actual ${got.actual} vs ${$(l.actual)}`);
    }
    expect(diffs).toEqual([]);
  });

  it("column totals, halves and each person's summary", () => {
    const t = c.totals!;
    const D = view.people.D, E = view.people.E;
    const got: Record<string, number> = {
      "Half #1 budget": Math.round(view.columns.shared.recurring.budget / 2), "Half #1 actual": Math.round(view.columns.shared.recurring.actual / 2),
      "Half #2 budget": Math.round(view.columns.shared.variable.budget / 2), "Half #2 actual": Math.round(view.columns.shared.variable.actual / 2),
      "Total #3 budget": view.columns.shared.recurring.budget, "Total #3 actual": view.columns.shared.recurring.actual,
      "Total #4 budget": view.columns.shared.variable.budget, "Total #4 actual": view.columns.shared.variable.actual,
      "Total recurring expenses #1 budget": D.recurringBudget, "Total recurring expenses #1 actual": D.recurringActual,
      "Total variable expenses #1 budget": D.variableBudget, "Total variable expenses #1 actual": D.variableActual,
      "Total recurring expenses #2 budget": E.recurringBudget, "Total recurring expenses #2 actual": E.recurringActual,
      "Total variable expenses #2 budget": E.variableBudget, "Total variable expenses #2 actual": E.variableActual,
      "Income #1 budget": D.incomeBudget, "Income #1 actual": D.incomeActual, "Income #2 budget": E.incomeBudget, "Income #2 actual": E.incomeActual,
      "Total spent #1 budget": line("D", "Fun Money").fun!.spent, "Total spent #2 budget": line("E", "Fun Money").fun!.spent,
      "Total recurring + variable #1 budget": D.totalBudget, "Total recurring + variable #1 actual": D.totalActual,
      "Total recurring + variable #2 budget": E.totalBudget, "Total recurring + variable #2 actual": E.totalActual,
      "Savings so far #1 budget": D.savingsBudget, "Savings so far #1 actual": D.savingsActual,
      "Savings so far #2 budget": E.savingsBudget, "Savings so far #2 actual": E.savingsActual,
      "Projected Savings (month end) #1 budget": D.projectedSavings, "Projected Savings (month end) #2 budget": E.projectedSavings,
      "+ Retirement & 529 contributions #1 budget": D.contributions, "+ Retirement & 529 contributions #2 budget": E.contributions,
      "Total put away #1 budget": D.putAway, "Total put away #2 budget": E.putAway,
      "Weekly budget #1 budget": line("D", "Fun Money").fun!.weeklyBudget, "Weekly budget #2 budget": line("E", "Fun Money").fun!.weeklyBudget,
      "Total remaining #1 budget": line("D", "Fun Money").fun!.remaining, "Total remaining #2 budget": line("E", "Fun Money").fun!.remaining,
      "Projected remaining at end of month #1 budget": line("D", "Fun Money").fun!.projectedRemaining, "Projected remaining at end of month #2 budget": line("E", "Fun Money").fun!.projectedRemaining,
    };
    const diffs = Object.entries(got).filter(([k, v]) => k in t && Math.abs(v - $(t[k]!)) > 1).map(([k, v]) => `${k}: ${v} vs ${$(t[k]!)}`);
    expect(diffs).toEqual([]);
  });
});

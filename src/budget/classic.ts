/**
 * The Classic view: the spreadsheet's three-column tab (Shared / David / Elizabeth), reproduced from the same data the
 * budget month uses. Pure: everything it needs comes in through ClassicInput.
 *
 * Rules (from the sheet's formulas):
 *  - every category has a Classic bucket (a line name) or a rule: by_account, phone_split, utilities_split, drive_split
 *  - a line's budget is the sum of "needed this month" of the categories that land on it; a few lines are typed instead
 *    (Internet, Cell Phone, Power, Utilities, Google Drive + iCloud); By-account categories' budgets count toward Misc shared
 *  - actuals route by the paying account's side: by_account -> that person's Fun Money (shared account -> Misc shared),
 *    and a 50/50 entry in a by_account category puts half in each Fun Money; utilities_split -> Power (D) / Utilities (E);
 *    phone_split -> Internet when the payee contains an Internet keyword, else Cell Phone; drive_split -> that side's line
 *  - income is typed per person (budget and actual); savings so far = income actual − (own + half of shared) actual
 *  - projection: each list line extrapolates its average daily spend over the days left; other lines count their budget
 */
import { daysInMonth, type ISODate, type MonthKey } from "./dates.js";
import type { Cents } from "./money.js";

export type ClassicColumn = "shared" | "D" | "E";
export type ClassicSection = "recurring" | "variable";
export type ClassicRule = "none" | "by_account" | "utilities_split" | "phone_split" | "drive_split";

export interface ClassicLineDef { name: string; column: ClassicColumn; section: ClassicSection; typed: boolean; defaultBudget: Cents }
export interface ClassicInput {
  month: MonthKey;
  today: ISODate;
  layout: ClassicLineDef[];
  keywords: string[];
  categories: { id: string; name: string; bucket: string | null; rule: ClassicRule }[];
  accounts: { id: string; owner: "D" | "E" | "shared" }[];
  needed: Record<string, Cents>; // categoryId -> needed this month (Misc shared sums these)
  goalMonthly: Record<string, Cents>; // categoryId -> the goal's monthly amount (every other bucket line shows this)
  typed: Record<string, Cents>; // "<column>:<name>" -> typed budget for this month
  income: Record<"D" | "E", { budget: Cents; actual: Cents }>;
  transactions: { id: string; date: ISODate; accountId: string; payee: string | null; hidden: boolean; masked: boolean; transferToAccountId: string | null; sharedFiftyFifty: boolean; lines: { categoryId: string | null; amount: Cents }[] }[];
}

export interface ClassicEntry { id: string; date: ISODate; payee: string; category: string; amount: Cents; half: boolean }
export interface ClassicLine {
  key: string; name: string; column: ClassicColumn; section: ClassicSection; typed: boolean;
  budget: Cents; actual: Cents; entries: ClassicEntry[]; categories: { id: string; name: string; needed: Cents }[];
  projection: { remaining: Cents; avgDaily: Cents; projectedRemaining: Cents } | null;
  fun: { weeklyBudget: Cents; spent: Cents; remaining: Cents; perDay: Cents; perWeek: Cents; weeksLeft: number; projectedRemaining: Cents } | null;
}
export interface ClassicPerson {
  incomeBudget: Cents; incomeActual: Cents; incomeActualTyped: boolean;
  shareBudget: Cents; shareActual: Cents; // half of shared (recurring + variable)
  recurringBudget: Cents; recurringActual: Cents; variableBudget: Cents; variableActual: Cents; // own + half shared
  totalBudget: Cents; totalActual: Cents;
  savingsBudget: Cents; savingsActual: Cents;
  projectedVariable: Cents; projectedSavings: Cents; contributions: Cents; putAway: Cents;
}
export interface ClassicView {
  month: MonthKey; daysElapsed: number; daysLeft: number;
  lines: ClassicLine[];
  columns: Record<ClassicColumn, { recurring: { budget: Cents; actual: Cents }; variable: { budget: Cents; actual: Cents }; half: { budget: Cents; actual: Cents } }>;
  people: Record<"D" | "E", ClassicPerson>;
  sharedProjectedSpend: Cents;
}

const key = (column: ClassicColumn, name: string) => `${column}:${name}`;
const FUN = "Fun Money";
const r2 = (x: number) => Math.round(x);

export function computeClassic(input: ClassicInput): ClassicView {
  const { month, today } = input;
  const dim = daysInMonth(month);
  const cur = today.slice(0, 7) === month.slice(0, 7);
  const daysElapsed = cur ? Number(today.slice(8, 10)) : today < month ? 0 : dim;
  const daysLeft = dim - daysElapsed;

  const lines: ClassicLine[] = input.layout.map((d) => ({
    key: key(d.column, d.name), name: d.name, column: d.column, section: d.section, typed: d.typed,
    budget: d.typed ? (input.typed[key(d.column, d.name)] ?? d.defaultBudget) : 0, actual: 0, entries: [], categories: [], projection: null, fun: null,
  }));
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const byName = (name: string, prefer?: ClassicColumn) => (prefer && byKey.get(key(prefer, name))) || lines.find((l) => l.name === name) || null;
  /** where a bucket name lands: "David Fun Money" -> D's Fun Money line, otherwise the line of that name */
  const bucketLine = (bucket: string | null): ClassicLine | null => {
    if (!bucket) return null;
    if (bucket === "David Fun Money") return byName(FUN, "D");
    if (bucket === "Elizabeth Fun Money") return byName(FUN, "E");
    return byName(bucket);
  };
  const owner = new Map(input.accounts.map((a) => [a.id, a.owner]));
  const cats = new Map(input.categories.map((c) => [c.id, c]));
  const kws = input.keywords.map((k) => k.toLowerCase()).filter(Boolean);

  // budgets: Misc shared = sum of needed this month across its categories (By-account ones included);
  // any other bucket line = the goal's monthly amount of the categories on it
  for (const c of input.categories) {
    const needed = input.needed[c.id] ?? 0;
    const target = c.rule === "by_account" ? byName("Misc shared") : c.rule === "none" ? bucketLine(c.bucket) : null;
    if (!target) continue;
    target.categories.push({ id: c.id, name: c.name, needed });
    if (!target.typed) target.budget += target.name === "Misc shared" ? needed : (input.goalMonthly[c.id] ?? 0);
  }

  // actuals: each transaction line onto a line (or half onto each Fun Money)
  const txns = [...input.transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const x of txns) {
    if (x.transferToAccountId || x.date.slice(0, 7) !== month.slice(0, 7)) continue;
    const side = owner.get(x.accountId) ?? "shared";
    for (const l of x.lines) {
      if (!l.categoryId) continue; // income
      const c = cats.get(l.categoryId); if (!c) continue;
      const spend = -l.amount; // outflow positive
      const payee = x.masked ? "[Hidden]" : x.payee || "—";
      const add = (line: ClassicLine | null, amount: Cents, half = false) => { if (!line) return; line.actual += amount; line.entries.push({ id: x.id, date: x.date, payee, category: c.name, amount, half }); };
      switch (c.rule) {
        case "by_account":
          if (x.sharedFiftyFifty) { add(byName(FUN, "D"), r2(spend / 2), true); add(byName(FUN, "E"), spend - r2(spend / 2), true); }
          else add(side === "D" ? byName(FUN, "D") : side === "E" ? byName(FUN, "E") : byName("Misc shared"), spend);
          break;
        case "utilities_split": add(side === "D" ? byName("Power") : byName("Utilities"), spend); break;
        case "phone_split": add(kws.some((k) => (x.payee ?? "").toLowerCase().includes(k)) ? byName("Internet") : byName("Cell Phone"), spend); break;
        case "drive_split": add(byName("Google Drive + iCloud", side === "E" ? "E" : "D"), spend); break;
        default: add(bucketLine(c.bucket), spend);
      }
    }
  }

  // projection per variable line with a list; Fun Money stats
  for (const l of lines) {
    if (l.section !== "variable") continue;
    const remaining = l.budget - l.actual;
    const avgDaily = daysElapsed > 0 ? l.actual / daysElapsed : 0;
    const projectedRemaining = r2(remaining - avgDaily * daysLeft);
    l.projection = { remaining, avgDaily: r2(avgDaily), projectedRemaining };
    if (l.name === FUN) {
      const weeksLeft = daysLeft / 7;
      l.fun = { weeklyBudget: r2(l.budget / (dim / 7)), spent: l.actual, remaining, perDay: daysLeft > 0 ? r2(remaining / daysLeft) : remaining, perWeek: weeksLeft > 0 ? r2(remaining / weeksLeft) : remaining, weeksLeft: Math.round(weeksLeft * 10) / 10, projectedRemaining };
    }
  }

  const sum = (col: ClassicColumn, sec: ClassicSection, f: "budget" | "actual") => lines.filter((l) => l.column === col && l.section === sec).reduce((s, l) => s + l[f], 0);
  const columns = {} as ClassicView["columns"];
  for (const col of ["shared", "D", "E"] as const) {
    const rb = sum(col, "recurring", "budget"), ra = sum(col, "recurring", "actual"), vb = sum(col, "variable", "budget"), va = sum(col, "variable", "actual");
    columns[col] = { recurring: { budget: rb, actual: ra }, variable: { budget: vb, actual: va }, half: { budget: r2((rb + vb) / 2), actual: r2((ra + va) / 2) } };
  }
  const projSpend = (l: ClassicLine) => (l.projection ? l.budget - l.projection.projectedRemaining : l.budget);
  // the sheet projects the three shared lists (Misc shared, Groceries, Gas) and takes the budget for the rest
  const isList = (l: ClassicLine) => l.section === "variable" && (l.name === "Misc shared" || l.name === "Groceries" || l.name === "Gas" || l.name === FUN);
  const sharedProjectedSpend = lines.filter((l) => l.column === "shared" && l.section === "variable").reduce((s, l) => s + (isList(l) ? projSpend(l) : l.budget), 0);

  const people = {} as ClassicView["people"];
  for (const p of ["D", "E"] as const) {
    const col = columns[p], sh = columns.shared;
    const halfRecB = r2(sh.recurring.budget / 2), halfRecA = r2(sh.recurring.actual / 2), halfVarB = r2(sh.variable.budget / 2), halfVarA = r2(sh.variable.actual / 2);
    const recurringBudget = col.recurring.budget + halfRecB, recurringActual = col.recurring.actual + halfRecA;
    const variableBudget = col.variable.budget + halfVarB, variableActual = col.variable.actual + halfVarA;
    const totalBudget = recurringBudget + variableBudget, totalActual = recurringActual + variableActual;
    const inc = input.income[p];
    const incomeActualTyped = inc.actual > 0;
    const incomeForProjection = incomeActualTyped ? inc.actual : inc.budget;
    const ownVariable = lines.filter((l) => l.column === p && l.section === "variable").reduce((s, l) => s + (isList(l) ? projSpend(l) : l.budget), 0);
    const projectedVariable = r2(sharedProjectedSpend / 2) + ownVariable;
    const projectedSavings = incomeForProjection - (projectedVariable + recurringBudget);
    const contributions = lines.filter((l) => l.column === p && l.section === "recurring" && /retirement|529/i.test(l.name)).reduce((s, l) => s + l.budget, 0);
    people[p] = {
      incomeBudget: inc.budget, incomeActual: inc.actual, incomeActualTyped,
      shareBudget: halfRecB + halfVarB, shareActual: halfRecA + halfVarA,
      recurringBudget, recurringActual, variableBudget, variableActual, totalBudget, totalActual,
      savingsBudget: inc.budget - totalBudget, savingsActual: inc.actual - totalActual,
      projectedVariable, projectedSavings, contributions, putAway: projectedSavings + contributions,
    };
  }
  return { month, daysElapsed, daysLeft, lines, columns, people, sharedProjectedSpend };
}

/**
 * Whose spending a set of entries is, by Classic's own routing (shared lines → shared; a person's lines → that person;
 * a 50/50 entry in a by-account category half each), optionally only through a date. Used by Reports' "who spent".
 */
export function attributeSpend(input: ClassicInput, through: ISODate | null): Record<ClassicColumn, Cents> & { lines: { column: ClassicColumn; name: string; amount: Cents }[] } {
  const txns = through ? input.transactions.filter((x) => x.date <= through) : input.transactions;
  const view = computeClassic({ ...input, transactions: txns });
  const out = { shared: 0, D: 0, E: 0, lines: [] as { column: ClassicColumn; name: string; amount: Cents }[] };
  for (const l of view.lines) { out[l.column] += l.actual; if (l.actual) out.lines.push({ column: l.column, name: l.name, amount: l.actual }); }
  return out;
}

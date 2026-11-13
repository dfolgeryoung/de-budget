/**
 * The budget engine: the spreadsheet's formulas as pure functions over plain data.
 * No database, no dates as Date objects, money as integer cents. Everything here is
 * covered by tests/engine.test.ts against fixtures exported from the spreadsheet.
 */
import { addMonths, daysInMonth, dayOf, monthOf, monthsBetween, type ISODate, type MonthKey } from "./dates.js";
import type { Cents } from "./money.js";

// ---------- input shapes (a subset of the DB rows) ----------
export interface AccountIn {
  id: string;
  type: "checking" | "savings" | "credit_card";
  onBudget: boolean;
  owner: "D" | "E" | "shared";
  startingBalance: Cents;
  startingDate: ISODate;
}
export interface CategoryIn {
  id: string;
  groupId: string;
  kind: "normal" | "card_payment" | "next_month" | "savings_mirror";
  accountId?: string | null; // card_payment: the card it pays
  hiddenInBudget?: boolean;
}
export interface LineIn {
  categoryId: string | null; // null = Ready to Assign
  amount: Cents; // signed
}
export interface TransactionIn {
  id: string;
  date: ISODate;
  accountId: string;
  amount: Cents; // signed: outflow negative, inflow positive
  transferToAccountId?: string | null;
  sharedFiftyFifty?: boolean;
  lines: LineIn[];
  confirmed?: boolean;
}
export interface AssignmentIn {
  categoryId: string;
  month: MonthKey;
  amount: Cents;
}
export interface GoalIn {
  categoryId: string;
  validFrom: MonthKey;
  type: "refill_to" | "set_aside";
  amount: Cents;
  frequencyMonths?: number | null;
  targetDate?: ISODate | null;
}

export interface BudgetInput {
  accounts: AccountIn[];
  categories: CategoryIn[];
  transactions: TransactionIn[];
  assignments: AssignmentIn[];
  goals: GoalIn[];
  firstMonth: MonthKey; // the first budgeted month (before it: history / starting balances)
  /** Available already sitting in each category when firstMonth opens (from the last history month). */
  openingAvailable?: Record<string, Cents>;
}

// ---------- output shapes ----------
export type GoalStatus = "funded" | "underfunded" | "not_enough" | "covered" | "overspent" | "none";

export interface CategoryMonth {
  categoryId: string;
  carriedIn: Cents;
  assigned: Cents;
  activity: Cents; // signed (spending negative)
  available: Cents;
  // goal
  goal: GoalIn | null;
  needed: Cents; // needed this month
  short: Cents; // max(0, needed - assigned) for the month share
  status: GoalStatus;
  progress: number; // 0..1 bar fill
}

export interface MonthView {
  month: MonthKey;
  readyToAssign: Cents;
  cashOnBudget: Cents;
  categories: CategoryMonth[];
  owedOnCards: Cents;
  setAsideForCards: Cents;
  uncoveredCardDebt: Cents;
  zeroCheck: Cents; // cashOnBudget - (sum available + RTA); must be 0
}

// ---------- helpers ----------
const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x] as const));

/** Account balance at end of `asOf` (inclusive), from starting balance + all transactions. */
export function accountBalance(input: BudgetInput, accountId: string, asOf?: ISODate): Cents {
  const acct = byId(input.accounts).get(accountId);
  if (!acct) throw new Error(`unknown account ${accountId}`);
  let bal = acct.startingBalance;
  // 50/50 entries: the paying person's checking is owed half by the other person's checking
  const checkingOf = (owner: "D" | "E") => input.accounts.find((a) => a.type === "checking" && a.owner === owner)?.id;
  for (const t of input.transactions) {
    if (asOf && t.date > asOf) continue;
    if (t.confirmed === false) continue;
    if (t.accountId === accountId) bal += t.amount;
    if (t.transferToAccountId === accountId) bal -= t.amount; // amount is negative on the source side
    if (t.sharedFiftyFifty && !t.transferToAccountId) {
      const payer = byId(input.accounts).get(t.accountId);
      if (payer && payer.owner !== "shared") {
        const other = checkingOf(payer.owner === "D" ? "E" : "D");
        const half = Math.round(-t.amount / 2); // positive for an outflow
        if (accountId === t.accountId) bal += half; // reimbursement due to the payer
        if (accountId === other) bal -= half; // owed by the other
      }
    }
  }
  return bal;
}

/** On-budget cash: checking and savings only. Card balances are debt, covered by their payment categories. */
export function cashOnBudget(input: BudgetInput, asOf?: ISODate): Cents {
  return input.accounts
    .filter((a) => a.onBudget && a.type !== "credit_card")
    .reduce((s, a) => s + accountBalance(input, a.id, asOf), 0);
}

/** Activity per category for a month: sum of lines dated in that month; card purchases also hold money in the card's payment category. */
export function activityByCategory(input: BudgetInput, month: MonthKey): Map<string, Cents> {
  const acct = byId(input.accounts);
  const cardPayCat = new Map<string, string>(); // accountId -> card_payment categoryId
  for (const c of input.categories) if (c.kind === "card_payment" && c.accountId) cardPayCat.set(c.accountId, c.id);
  const out = new Map<string, Cents>();
  const add = (k: string, v: Cents) => out.set(k, (out.get(k) ?? 0) + v);
  for (const t of input.transactions) {
    if (monthOf(t.date) !== month || t.confirmed === false) continue;
    const a = acct.get(t.accountId);
    if (t.transferToAccountId) {
      // paying a card: transfer from checking to the card reduces what is set aside
      const payCat = cardPayCat.get(t.transferToAccountId);
      if (payCat && a?.type !== "credit_card") add(payCat, t.amount); // amount negative => set-aside goes down
      const fromPayCat = cardPayCat.get(t.accountId);
      if (fromPayCat && a?.type === "credit_card") add(fromPayCat, -t.amount);
      continue;
    }
    for (const l of t.lines) {
      if (l.categoryId) add(l.categoryId, l.amount);
      if (a?.type === "credit_card") {
        const payCat = cardPayCat.get(a.id);
        if (payCat && l.categoryId) add(payCat, -l.amount); // spending on the card holds the same amount for its payment
      }
    }
  }
  return out;
}

/** Income to Ready to Assign in a month: lines with no category. */
export function incomeToRTA(input: BudgetInput, month: MonthKey): Cents {
  let s = 0;
  for (const t of input.transactions) {
    if (monthOf(t.date) !== month || t.confirmed === false || t.transferToAccountId) continue;
    for (const l of t.lines) if (!l.categoryId) s += l.amount;
  }
  return s;
}

/** Net transfers between on-budget and off-budget accounts in a month (money entering or leaving the budget). */
export function offBudgetNet(input: BudgetInput, month: MonthKey): Cents {
  const acct = byId(input.accounts);
  let s = 0;
  for (const t of input.transactions) {
    if (monthOf(t.date) !== month || t.confirmed === false || !t.transferToAccountId) continue;
    const from = acct.get(t.accountId), to = acct.get(t.transferToAccountId);
    if (!from || !to) continue;
    if (!from.onBudget && to.onBudget) s += -t.amount; // money arriving on budget
    if (from.onBudget && !to.onBudget) s += t.amount; // money leaving (amount negative)
  }
  return s;
}

function goalFor(goals: GoalIn[], categoryId: string, month: MonthKey): GoalIn | null {
  let best: GoalIn | null = null;
  for (const g of goals) {
    if (g.categoryId !== categoryId || g.validFrom > month) continue;
    if (!best || g.validFrom > best.validFrom) best = g;
  }
  return best && best.amount > 0 ? best : null; // a zero-amount goal row means "no goal from this month on"
}

/** Needed this month (the sheet's rule): refill_to spreads the gap over the months left in the cycle; set_aside is goal/frequency; a target date overrides. */
export function neededThisMonth(goal: GoalIn | null, carriedIn: Cents, available: Cents, month: MonthKey): Cents {
  if (!goal) return 0;
  if (goal.targetDate) {
    // what is still missing before this month's assignment, spread over the months left (this one included)
    const left = Math.max(1, monthsBetween(month, monthOf(goal.targetDate)) + 1);
    return Math.max(0, Math.ceil(Math.max(0, goal.amount - carriedIn) / left));
  }
  const freq = Math.max(1, goal.frequencyMonths ?? 1);
  if (goal.type === "set_aside") return Math.round(goal.amount / freq);
  // refill_to: months left in the cycle counts from the goal's validFrom
  const sinceStart = monthsBetween(goal.validFrom, month);
  const left = freq - (((sinceStart % freq) + freq) % freq);
  return Math.max(0, Math.ceil(Math.max(0, goal.amount - carriedIn) / left));
}

/** Compute one month. `firstMonth` RTA starts from starting balances minus balances carried into it. */
export function computeMonth(input: BudgetInput, month: MonthKey): MonthView {
  const cats = input.categories.filter((c) => c.kind !== "savings_mirror");
  // walk months from firstMonth to month to accumulate carried balances
  const carried = new Map<string, Cents>(Object.entries(input.openingAvailable ?? {}));
  let rtaCarried = 0;
  let m = input.firstMonth;
  const assignedIn = (mm: MonthKey) => {
    const out = new Map<string, Cents>();
    for (const a of input.assignments) if (a.month === mm) out.set(a.categoryId, (out.get(a.categoryId) ?? 0) + a.amount);
    return out;
  };
  // the month before firstMonth: starting balances define cash; nothing carried into categories
  while (m < month) {
    const act = activityByCategory(input, m);
    const asg = assignedIn(m);
    let totalAssigned = 0;
    for (const c of cats) {
      const avail = (carried.get(c.id) ?? 0) + (asg.get(c.id) ?? 0) + (act.get(c.id) ?? 0);
      totalAssigned += asg.get(c.id) ?? 0;
      carried.set(c.id, avail); // the sheet carries Available as it is, negative included
    }
    rtaCarried += incomeToRTA(input, m) + offBudgetNet(input, m) - totalAssigned;
    m = addMonths(m, 1);
  }
  const act = activityByCategory(input, month);
  const asg = assignedIn(month);
  const categories: CategoryMonth[] = [];
  let totalAssigned = 0;
  let sumAvailable = 0;
  for (const c of cats) {
    const carriedIn = carried.get(c.id) ?? 0;
    const assigned = asg.get(c.id) ?? 0;
    const activity = act.get(c.id) ?? 0;
    const available = carriedIn + assigned + activity;
    totalAssigned += assigned;
    sumAvailable += available;
    const goal = goalFor(input.goals, c.id, month);
    const needed = neededThisMonth(goal, carriedIn, available, month);
    const short = Math.max(0, needed - assigned);
    let status: GoalStatus = "none";
    if (available < 0) status = "overspent";
    else if (goal) {
      if (goal.type === "refill_to" && available >= goal.amount) status = "funded";
      else if (short === 0) status = "funded";
      else if (assigned > 0) status = "underfunded";
      else status = "not_enough";
    }
    const target = goal ? (goal.targetDate || goal.type === "refill_to" ? goal.amount : needed) : 0;
    const progress = target > 0 ? Math.max(0, Math.min(1, (goal?.targetDate || goal?.type === "refill_to" ? available : assigned) / target)) : available > 0 ? 1 : 0;
    categories.push({ categoryId: c.id, carriedIn, assigned, activity, available, goal, needed, short, status, progress });
  }
  // First-month RTA = starting cash minus balances already in categories (the sheet's "Carried in"); then it carries in full.
  const startCash = input.accounts.filter((a) => a.onBudget && a.type !== "credit_card").reduce((s, a) => s + a.startingBalance, 0);
  const openingInCats = Object.values(input.openingAvailable ?? {}).reduce((s, v) => s + v, 0);
  const readyToAssign = startCash - openingInCats + rtaCarried + incomeToRTA(input, month) + offBudgetNet(input, month) - totalAssigned;
  const lastDay = `${month.slice(0, 7)}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const cash = cashOnBudget(input, lastDay);
  const cardCats = cats.filter((c) => c.kind === "card_payment");
  const setAside = categories.filter((x) => cardCats.some((c) => c.id === x.categoryId)).reduce((s, x) => s + x.available, 0);
  const owed = input.accounts.filter((a) => a.type === "credit_card" && a.onBudget).reduce((s, a) => s - accountBalance(input, a.id, lastDay), 0);
  return {
    month,
    readyToAssign,
    cashOnBudget: cash,
    categories,
    owedOnCards: owed,
    setAsideForCards: setAside,
    uncoveredCardDebt: owed - setAside, // negative = more set aside than owed, as the sheet shows it
    zeroCheck: cash - (sumAvailable + readyToAssign),
  };
}

/** Days of buffer = on-budget cash / (outflows in the last 30 days excluding transfers and income / 30). */
export function daysOfBuffer(input: BudgetInput, today: ISODate): number {
  const cash = cashOnBudget(input, today);
  const start = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) - 29)).toISOString().slice(0, 10);
  let out = 0;
  for (const t of input.transactions) {
    if (t.transferToAccountId || t.date < start || t.date > today || t.confirmed === false) continue;
    for (const l of t.lines) if (l.categoryId && l.amount < 0) out -= l.amount;
  }
  if (out === 0) return Infinity;
  return Math.round(cash / (out / 30));
}

/** Weekly fun-money allowance: left / weeks remaining (days left incl. today / 7). */
export function weeklyAllowance(left: Cents, today: ISODate): { perWeek: Cents; weeksLeft: number } {
  const m = monthOf(today);
  const weeks = (daysInMonth(m) - dayOf(today) + 1) / 7;
  return { perWeek: Math.round(left / weeks), weeksLeft: Math.round(weeks * 10) / 10 };
}

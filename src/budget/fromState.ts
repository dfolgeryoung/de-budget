/**
 * Map the spreadsheet's state export (state.json, produced by extract_state.py from the
 * Google Sheets text export) into the engine's input, plus the sheet's own computed
 * figures for the acceptance check. The one-time migration importer uses the same mapping.
 */
import type { BudgetInput, AccountIn, CategoryIn, TransactionIn, AssignmentIn, GoalIn } from "./engine.js";
import { monthOf, type ISODate, type MonthKey } from "./dates.js";

export interface SheetState {
  accounts: [name: string, type: string, onBudget: string, starting: number][];
  first_month: ISODate;
  current_month: ISODate;
  ledger: [date: ISODate | null, account: string, payee: string, category: string, memo: string, out: number | null, inflow: number | null, hidden: boolean][];
  months: Record<string, SheetMonth>;
  history: Record<string, { cats: Record<string, { assigned: number | null; activity: number | null; available: number | null }> }>;
  recurring?: string[][];
  moves?: string[][];
  pinned?: string[]; // the Ledger tab's "Pinned categories (dropdown order)" list
  classic?: SheetClassic;
}
/** What the Classic tab holds besides formulas: its mapping tables, the typed income table and the line layout with budgets. */
export interface SheetClassic {
  month: ISODate; // the month the tab was showing when exported (its typed budgets belong to it)
  mapping: [category: string, bucket: string][];
  sides: [account: string, side: string][];
  keywords: string[];
  income: Record<ISODate, { D: [budget: number, actual: number]; E: [budget: number, actual: number] }>;
  layout: { name: string; column: "shared" | "D" | "E"; section: "recurring" | "variable"; budget: number; actual: number }[];
  /** the tab's own figures (per column), kept for the acceptance check */
  totals?: Record<string, number>;
}
export interface SheetMonth {
  picked: string;
  rta: number | null;
  accounts: Record<string, number>;
  groups: [name: string, categories: string[]][];
  cats: Record<string, { assigned: number | null; goal_type: string; goal_amount: number | null; freq: number | null; goal_date: ISODate | null; activity: number | null; available: number | null; group: string }>;
}

export const SPLIT_SUFFIX = " (split)";
export const SPLIT_CAT = "Split across categories";
export const CHILD_PREFIX = "↳ ";
export const RTA_NAME = "Ready to Assign";
export const TRANSFER_PREFIX = "Transfer: ";
export const CARD_GROUP = "Credit Card Payments";
export const NEXT_MONTH_GROUP = "One Month Ahead";

export const cents = (x: number | null | undefined): number => (x == null ? 0 : Math.round(x * 100));
export const slug = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function tabToMonth(tab: string): MonthKey {
  const [mon, year] = tab.split(" ");
  return `${year}-${String(MONTHS.indexOf(mon!) + 1).padStart(2, "0")}-01`;
}

export interface Mapped {
  input: BudgetInput;
  names: { accounts: Map<string, string>; categories: Map<string, string> }; // name -> id
  groups: { id: string; name: string; sortOrder: number; system: boolean; categories: string[] }[];
  expected: Record<MonthKey, { rta: number; available: Record<string, number>; activity: Record<string, number>; accounts: Record<string, number> }>;
  hidden: Set<string>; // transaction ids with the Hide tick
  entries: { id: string; payee: string; memo: string; hidden: boolean }[];
}

export function mapState(state: SheetState): Mapped {
  const accountIds = new Map<string, string>();
  const accounts: AccountIn[] = state.accounts.map(([name, type, onBudget, starting]) => {
    const id = `acct-${slug(name)}`;
    accountIds.set(name, id);
    return {
      id,
      type: type === "Checking" ? "checking" : type === "Savings" ? "savings" : "credit_card",
      onBudget: onBudget === "Yes",
      owner: name.startsWith("D ") ? "D" : name.startsWith("E ") ? "E" : "shared",
      startingBalance: cents(starting),
      startingDate: state.first_month,
    };
  });

  // categories and groups from the latest live month's layout
  const liveTabs = Object.keys(state.months).sort((a, b) => (tabToMonth(a) < tabToMonth(b) ? -1 : 1));
  const layoutTab = liveTabs[0]!; // earliest live month holds the full layout too
  const layout = state.months[layoutTab]!;
  const categoryIds = new Map<string, string>();
  const categories: CategoryIn[] = [];
  const groups: Mapped["groups"] = [];
  layout.groups.forEach(([gname, cats], gi) => {
    const gid = `grp-${slug(gname)}`;
    groups.push({ id: gid, name: gname, sortOrder: gi, system: gname === CARD_GROUP || gname === NEXT_MONTH_GROUP, categories: [] });
    cats.forEach((cname) => {
      const id = `cat-${slug(cname)}`;
      categoryIds.set(cname, id);
      groups[gi]!.categories.push(id);
      const kind = gname === CARD_GROUP ? "card_payment" : gname === NEXT_MONTH_GROUP ? "next_month" : "normal";
      categories.push({ id, groupId: gid, kind, accountId: kind === "card_payment" ? (accountIds.get(cname) ?? null) : null });
    });
  });

  // transactions: parents with split children folded into lines
  const transactions: TransactionIn[] = [];
  const entries: Mapped["entries"] = [];
  const hidden = new Set<string>();
  let last: TransactionIn | null = null;
  state.ledger.forEach((row, i) => {
    const [date, accountRaw, payee, category, memo, out, inflow, hid] = row;
    const amount = cents(inflow) - cents(out);
    if (payee.startsWith(CHILD_PREFIX) && !accountRaw && last) {
      // child line of a category split: belongs to the previous parent
      last.lines.push({ categoryId: categoryIds.get(category) ?? null, amount });
      return;
    }
    if (!date) return;
    const shared = accountRaw.endsWith(SPLIT_SUFFIX);
    const accountName = shared ? accountRaw.slice(0, -SPLIT_SUFFIX.length) : accountRaw;
    const accountId = accountIds.get(accountName);
    if (!accountId) throw new Error(`row ${i}: unknown account "${accountRaw}"`);
    const id = `txn-${String(i + 1).padStart(4, "0")}`;
    const t: TransactionIn = { id, date, accountId, amount, sharedFiftyFifty: shared, lines: [] };
    if (category.startsWith(TRANSFER_PREFIX)) {
      const to = accountIds.get(category.slice(TRANSFER_PREFIX.length));
      if (!to) throw new Error(`row ${i}: unknown transfer target "${category}"`);
      t.transferToAccountId = to;
    } else if (category === SPLIT_CAT) {
      // lines arrive from the child rows that follow
    } else if (category === RTA_NAME) {
      t.lines.push({ categoryId: null, amount });
    } else {
      const cid = categoryIds.get(category);
      if (!cid) throw new Error(`row ${i}: unknown category "${category}"`);
      t.lines.push({ categoryId: cid, amount });
    }
    transactions.push(t);
    entries.push({ id, payee, memo, hidden: hid });
    if (hid) hidden.add(id);
    last = t;
  });

  // assignments and goals per live month
  const assignments: AssignmentIn[] = [];
  const goals: GoalIn[] = [];
  for (const tab of liveTabs) {
    const month = tabToMonth(tab);
    for (const [cname, c] of Object.entries(state.months[tab]!.cats)) {
      const cid = categoryIds.get(cname);
      if (!cid) continue;
      if (c.assigned) assignments.push({ categoryId: cid, month, amount: cents(c.assigned) });
      if (c.goal_type && c.goal_amount) {
        const prev = goals.find((g) => g.categoryId === cid && g.validFrom < month);
        const next: GoalIn = {
          categoryId: cid,
          validFrom: month,
          type: c.goal_type === "Set aside another" ? "set_aside" : "refill_to",
          amount: cents(c.goal_amount),
          frequencyMonths: c.freq ?? null,
          targetDate: c.goal_date ?? null,
        };
        const same = prev && prev.type === next.type && prev.amount === next.amount && (prev.frequencyMonths ?? null) === next.frequencyMonths && (prev.targetDate ?? null) === next.targetDate;
        if (!same) goals.push(next);
      }
    }
  }

  // opening balances: the history month just before the first live month
  const firstMonth = monthOf(state.first_month);
  const histTabs = Object.keys(state.history).sort((a, b) => (tabToMonth(a) < tabToMonth(b) ? -1 : 1));
  const lastHist = histTabs.filter((t) => tabToMonth(t) < firstMonth).pop();
  const openingAvailable: Record<string, number> = {};
  if (lastHist) {
    for (const [cname, c] of Object.entries(state.history[lastHist]!.cats)) {
      const cid = categoryIds.get(cname);
      if (cid && c.available) openingAvailable[cid] = cents(c.available);
    }
  }

  // the sheet's own figures, for the acceptance check
  const expected: Mapped["expected"] = {};
  for (const tab of liveTabs) {
    const m = state.months[tab]!;
    const available: Record<string, number> = {}, activity: Record<string, number> = {};
    for (const [cname, c] of Object.entries(m.cats)) {
      const cid = categoryIds.get(cname);
      if (!cid) continue;
      available[cid] = cents(c.available);
      activity[cid] = cents(c.activity);
    }
    const accts: Record<string, number> = {};
    for (const [name, v] of Object.entries(m.accounts)) {
      const id = accountIds.get(name);
      if (id) accts[id] = cents(v);
    }
    expected[tabToMonth(tab)] = { rta: cents(m.rta), available, activity, accounts: accts };
  }

  return {
    input: { accounts, categories, transactions, assignments, goals, firstMonth, openingAvailable },
    names: { accounts: accountIds, categories: categoryIds },
    groups,
    expected,
    hidden,
    entries,
  };
}

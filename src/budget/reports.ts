/**
 * Reports: what was spent, by whom and on what, how the month is pacing and where it will land.
 * Pure functions over the same BudgetInput the engine uses; every headline figure comes with the
 * lines of arithmetic behind it (`explain`) so the screen can show its working.
 */
import { addMonths, daysInMonth, dayOf, monthOf, type ISODate, type MonthKey } from "./dates.js";
import { computeMonth, incomeToRTA, type BudgetInput } from "./engine.js";
import type { Cents } from "./money.js";

export interface ReportCategoryMeta { id: string; name: string; emoji: string | null; kind: string; hidden?: boolean }
export interface ReportRecurring { id: string; payee: string; amount: Cents; day: number | null; categoryId: string | null; accountId?: string }
export interface ReportsInput {
  input: BudgetInput;
  categories: ReportCategoryMeta[];
  recurring: ReportRecurring[];
  month: MonthKey;
  today: ISODate;
  /** whose spending it is, by Classic's routing (shared lines vs each person's); falls back to who paid */
  whoSpent?: (month: MonthKey, through: ISODate | null) => Record<"shared" | "D" | "E", Cents> & { lines?: { column: "shared" | "D" | "E"; name: string; amount: Cents }[] };
}

export interface ExplainRow { k: string; v: number | string; op?: string; result?: boolean; sub?: boolean }
export interface ExplainBox { title: string; rows: ExplainRow[]; note?: string }

/** budget = this month's plan: the larger of assigned and the goal's monthly need (or what was spent from carry-over when neither); assigned = this month's assignment alone. */
export interface CategorySpend { id: string; name: string; emoji: string | null; spent: Cents; budget: Cents; assigned: Cents; carriedIn: Cents; available: Cents }
export interface OwnerSpend { who: "shared" | "D" | "E"; spent: Cents; share: number; parts?: { name: string; amount: Cents }[] }
export interface Mover { id: string; name: string; emoji: string | null; now: Cents; before: Cents; delta: Cents }
export interface BillToCome { id: string; payee: string; amount: Cents; day: number | null; categoryId: string | null; accountId: string | null; overdue: boolean }
export interface ProjectedCategory { id: string; name: string; emoji: string | null; spent: Cents; billsLeft: Cents; avgDaily: number; projected: Cents; available: Cents; budget: Cents; over: Cents; isBills: boolean; how: "bills" | "daily" | "one-off" }

export interface ReportsView {
  month: MonthKey;
  prevMonth: MonthKey;
  daysElapsed: number; // days of the month counted so far (today's day, the whole month when past, 0 when future)
  daysInMonth: number;
  daysLeft: number;
  isCurrent: boolean;
  thisMonth: {
    spent: Cents;
    budgeted: Cents;
    onPace: Cents;
    vsLast: { pct: number | null; prevSpent: Cents; prevDay: number; summary: string };
    byCategory: CategorySpend[];
    byOwner: OwnerSpend[];
    movers: Mover[];
    billsToCome: BillToCome[];
    billsTotal: Cents;
    explain: { spent: ExplainBox; onPace: ExplainBox; vsLast: ExplainBox; who: ExplainBox };
  };
  trends: {
    months: { month: MonthKey; spent: Cents; income: Cents; assigned: Cents; byOwner: Record<"shared" | "D" | "E", Cents> }[];
    categories: { id: string; name: string; emoji: string | null; total: Cents; perMonth: Cents[] }[];
    explain: ExplainBox;
  };
  projection: {
    categories: ProjectedCategory[];
    totalProjected: Cents;
    totalAvailable: Cents;
    totalBudgeted: Cents;
    headingOver: ProjectedCategory[];
    explain: ExplainBox;
  };
}

const lastDayOf = (m: MonthKey) => `${m.slice(0, 7)}-${String(daysInMonth(m)).padStart(2, "0")}`;
const isoDay = (m: MonthKey, d: number) => `${m.slice(0, 7)}-${String(Math.min(d, daysInMonth(m))).padStart(2, "0")}`;

/** Spending categories only: card payments and savings mirrors hold money rather than spend it. */
const spendable = (c: { kind: string }) => c.kind === "normal" || c.kind === "next_month";

/** Net spending per category for a month, up to and including `through` (cents, positive = spent). Transfers are not spending. */
export function spendByCategory(input: BudgetInput, month: MonthKey, through: ISODate | null): Map<string, Cents> {
  const kinds = new Map(input.categories.map((c) => [c.id, c.kind]));
  const out = new Map<string, Cents>();
  for (const t of input.transactions) {
    if (monthOf(t.date) !== month || t.confirmed === false || t.transferToAccountId) continue;
    if (through && t.date > through) continue;
    for (const l of t.lines) {
      if (!l.categoryId) continue;
      const k = kinds.get(l.categoryId);
      if (k && !spendable({ kind: k })) continue;
      out.set(l.categoryId, (out.get(l.categoryId) ?? 0) - l.amount);
    }
  }
  return out;
}

/** Spending per payer: the account's owner pays, a 50/50 entry is half each. */
export function spendByOwner(input: BudgetInput, month: MonthKey, through: ISODate | null): Record<"shared" | "D" | "E", Cents> {
  const owner = new Map(input.accounts.map((a) => [a.id, a.owner]));
  const kinds = new Map(input.categories.map((c) => [c.id, c.kind]));
  const out = { shared: 0, D: 0, E: 0 };
  for (const t of input.transactions) {
    if (monthOf(t.date) !== month || t.confirmed === false || t.transferToAccountId) continue;
    if (through && t.date > through) continue;
    let spent = 0;
    for (const l of t.lines) if (l.categoryId && spendable({ kind: kinds.get(l.categoryId) ?? "normal" })) spent -= l.amount;
    if (!spent) continue;
    const who = owner.get(t.accountId) ?? "shared";
    if (t.sharedFiftyFifty && who !== "shared") { const half = Math.round(spent / 2); out.D += half; out.E += spent - half; }
    else out[who] += spent;
  }
  return out;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const pct = (a: number, b: number) => (b ? (a - b) / b : null);

export function computeReports(r: ReportsInput): ReportsView {
  const { input, month, today } = r;
  const meta = new Map(r.categories.map((c) => [c.id, c]));
  const name = (id: string) => meta.get(id)?.name ?? id;
  const emoji = (id: string) => meta.get(id)?.emoji ?? null;
  const dim = daysInMonth(month);
  const cur = monthOf(today);
  const isCurrent = month === cur;
  const daysElapsed = isCurrent ? dayOf(today) : month < cur ? dim : 0;
  const daysLeft = dim - daysElapsed;
  const through = daysElapsed ? isoDay(month, daysElapsed) : null;
  const prevMonth = addMonths(month, -1);
  const prevDay = Math.min(daysElapsed || dim, daysInMonth(prevMonth));
  const prevThrough = isoDay(prevMonth, prevDay);

  const view = computeMonth(input, month);
  const byCat = daysElapsed ? spendByCategory(input, month, through) : new Map<string, Cents>();
  const prevByCat = spendByCategory(input, prevMonth, prevThrough);
  const prevFull = spendByCategory(input, prevMonth, null);
  const assigned = new Map(view.categories.map((c) => [c.categoryId, c.assigned]));
  const availIn = new Map(view.categories.map((c) => [c.categoryId, Math.max(0, c.carriedIn + c.assigned)]));
  const carriedOf = new Map(view.categories.map((c) => [c.categoryId, c.carriedIn]));
  // this month's budget for a category: the larger of what was assigned and what its goal needs; a category with neither
  // (spending from a balance carried over) counts what it spent, up to what it had
  const budgetOf = new Map(view.categories.map((c) => {
    const planned = Math.max(0, c.assigned, c.needed);
    return [c.categoryId, planned > 0 ? planned : Math.max(0, Math.min(c.carriedIn + c.assigned, -c.activity))];
  }));

  const spentIds = new Set([...byCat.keys(), ...assigned.keys()].filter((id) => spendable({ kind: meta.get(id)?.kind ?? "normal" })));
  const byCategory: CategorySpend[] = [...spentIds]
    .map((id) => ({ id, name: name(id), emoji: emoji(id), spent: byCat.get(id) ?? 0, budget: budgetOf.get(id) ?? 0, assigned: assigned.get(id) ?? 0, carriedIn: carriedOf.get(id) ?? 0, available: availIn.get(id) ?? 0 }))
    .filter((c) => c.spent !== 0 || c.budget !== 0 || c.assigned !== 0)
    .sort((a, b) => b.spent - a.spent || b.budget - a.budget);
  const spent = sum(byCategory.map((c) => c.spent));
  const budgeted = sum(byCategory.map((c) => c.budget));

  // bills still to come: active recurring bills with no entry under that payee this month
  const payeesThisMonth = new Set(input.transactions.filter((x) => monthOf(x.date) === month && x.confirmed !== false).map((x) => (x.payee ?? "").trim().toLowerCase()));
  const billsToCome: BillToCome[] = r.recurring
    .filter((b) => !payeesThisMonth.has(b.payee.trim().toLowerCase()))
    .map((b) => ({ id: b.id, payee: b.payee, amount: Math.abs(b.amount), day: b.day, categoryId: b.categoryId, accountId: b.accountId ?? null, overdue: isCurrent && b.day !== null && b.day < daysElapsed }))
    .sort((a, b) => (a.day ?? 99) - (b.day ?? 99) || a.payee.localeCompare(b.payee));
  const billsTotal = sum(billsToCome.map((b) => b.amount));

  // on pace: spent so far + bills still to come + everyday spending at its average daily rate for the days left
  const recurringPayees = new Set(r.recurring.map((b) => b.payee.trim().toLowerCase()));
  let billsSoFar = 0;
  for (const t of input.transactions) {
    if (monthOf(t.date) !== month || t.confirmed === false || t.transferToAccountId || (through && t.date > through)) continue;
    if (!recurringPayees.has((t.payee ?? "").trim().toLowerCase())) continue;
    for (const l of t.lines) if (l.categoryId && spendable({ kind: meta.get(l.categoryId)?.kind ?? "normal" })) billsSoFar -= l.amount;
  }
  const everyday = spent - billsSoFar;
  const avgDaily = daysElapsed ? everyday / daysElapsed : 0;
  let onPace = budgeted; // settled below once the per-category projection is in

  // vs last month, same day
  const prevSpent = sum([...prevByCat.values()]);
  const vsPct = pct(spent, prevSpent);
  const movers: Mover[] = [...new Set([...byCat.keys(), ...prevByCat.keys()])]
    .filter((id) => spendable({ kind: meta.get(id)?.kind ?? "normal" }))
    .map((id) => ({ id, name: name(id), emoji: emoji(id), now: byCat.get(id) ?? 0, before: prevByCat.get(id) ?? 0, delta: (byCat.get(id) ?? 0) - (prevByCat.get(id) ?? 0) }))
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const ups = movers.filter((m) => m.delta > 0).slice(0, 2).map((m) => m.name);
  const downs = movers.filter((m) => m.delta < 0).slice(0, 1).map((m) => m.name);
  const summary = !prevSpent ? "Nothing recorded last month" : [ups.length ? `${ups.join(" and ")} up` : "", downs.length ? `${downs.join(", ")} down` : ""].filter(Boolean).join("; ") || "About the same mix";

  // who spent
  type Who = Record<"shared" | "D" | "E", Cents> & { lines?: { column: "shared" | "D" | "E"; name: string; amount: Cents }[] };
  const who = (m: MonthKey, th: ISODate | null): Who => (r.whoSpent ? r.whoSpent(m, th) : spendByOwner(input, m, th));
  const owners: Who = daysElapsed ? who(month, through) : { shared: 0, D: 0, E: 0 };
  const ownerTotal = owners.shared + owners.D + owners.E;
  // the shared slice broken down by Classic line (biggest first, the long tail folded into "Other shared")
  const sharedLines = (owners.lines ?? []).filter((l) => l.column === "shared" && l.amount > 0).sort((a, b) => b.amount - a.amount);
  const topShared = sharedLines.slice(0, 6), rest = sum(sharedLines.slice(6).map((l) => l.amount));
  const parts = [...topShared.map((l) => ({ name: l.name, amount: l.amount })), ...(rest > 0 ? [{ name: "Other shared", amount: rest }] : [])];
  const byOwner: OwnerSpend[] = (["shared", "D", "E"] as const).map((who) => ({ who, spent: owners[who], share: ownerTotal ? owners[who] / ownerTotal : 0, ...(who === "shared" && parts.length ? { parts } : {}) }));

  // ----- trends: the last six months up to this one
  // months before the budget began still have their entries (history), just nothing assigned
  const earliest = input.transactions.reduce((e, t) => (t.date < e ? t.date : e), today).slice(0, 7) + "-01";
  const first = earliest < input.firstMonth ? earliest : input.firstMonth;
  const tm: MonthKey[] = [];
  for (let m = addMonths(month, -5); m <= month; m = addMonths(m, 1)) if (m >= first) tm.push(m);
  if (!tm.length) tm.push(month);
  const trendMonths = tm.map((m) => {
    const full = spendByCategory(input, m, m === month ? through : null);
    const assignedTotal = m < input.firstMonth ? 0 : sum((m === month ? view : computeMonth(input, m)).categories.map((c) => c.assigned));
    return { month: m, spent: sum([...full.values()]), income: incomeToRTA(input, m), assigned: assignedTotal, byOwner: (({ shared, D, E }) => ({ shared, D, E }))(who(m, m === month ? through : null)), full };
  });
  const catTotals = new Map<string, Cents>();
  for (const t of trendMonths) for (const [id, v] of t.full) catTotals.set(id, (catTotals.get(id) ?? 0) + v);
  const trendCategories = [...catTotals.entries()].filter(([id]) => spendable({ kind: meta.get(id)?.kind ?? "normal" })).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, total]) => ({ id, name: name(id), emoji: emoji(id), total, perMonth: trendMonths.map((t) => t.full.get(id) ?? 0) }));

  // ----- projection: where each category lands at month end
  const billsLeftByCat = new Map<string, Cents>();
  for (const b of billsToCome) if (b.categoryId) billsLeftByCat.set(b.categoryId, (billsLeftByCat.get(b.categoryId) ?? 0) + b.amount);
  const billsSoFarByCat = new Map<string, Cents>();
  for (const t of input.transactions) {
    if (monthOf(t.date) !== month || t.confirmed === false || t.transferToAccountId || (through && t.date > through)) continue;
    if (!recurringPayees.has((t.payee ?? "").trim().toLowerCase())) continue;
    for (const l of t.lines) if (l.categoryId) billsSoFarByCat.set(l.categoryId, (billsSoFarByCat.get(l.categoryId) ?? 0) - l.amount);
  }
  const recurringCats = new Set(r.recurring.map((b) => b.categoryId).filter(Boolean) as string[]);
  // everyday categories (steady spending: three or more entries so far, or spending in both of the last two months)
  // keep their daily rate; a one-off lands at the larger of what it spent and its budget
  const entriesThisMonth = new Map<string, number>();
  const monthsWithSpend = new Map<string, Set<string>>();
  for (const t of input.transactions) {
    if (t.confirmed === false || t.transferToAccountId) continue;
    const tm = monthOf(t.date);
    for (const l of t.lines) {
      if (!l.categoryId || l.amount >= 0) continue;
      if (tm === month && (!through || t.date <= through)) entriesThisMonth.set(l.categoryId, (entriesThisMonth.get(l.categoryId) ?? 0) + 1);
      if (tm === prevMonth || tm === addMonths(month, -2)) (monthsWithSpend.get(l.categoryId) ?? monthsWithSpend.set(l.categoryId, new Set()).get(l.categoryId)!).add(tm);
    }
  }
  const isEveryday = (id: string) => (entriesThisMonth.get(id) ?? 0) >= 3 || (monthsWithSpend.get(id)?.size ?? 0) === 2;
  const projCats: ProjectedCategory[] = [...new Set([...spentIds, ...billsLeftByCat.keys()])]
    .filter((id) => spendable({ kind: meta.get(id)?.kind ?? "normal" }))
    .map((id) => {
      const s = byCat.get(id) ?? 0, bl = billsLeftByCat.get(id) ?? 0, ev = s - (billsSoFarByCat.get(id) ?? 0);
      const isBills = recurringCats.has(id);
      const how: ProjectedCategory["how"] = isBills ? "bills" : isEveryday(id) ? "daily" : "one-off";
      const ad = daysElapsed && how === "daily" ? ev / daysElapsed : 0;
      const available = availIn.get(id) ?? 0, budget = budgetOf.get(id) ?? 0;
      const projected = !daysElapsed ? available + bl : how === "one-off" ? Math.max(s + bl, budget) : s + bl + Math.round(ad * daysLeft);
      return { id, name: name(id), emoji: emoji(id), spent: s, billsLeft: bl, avgDaily: ad, projected, available, budget, over: Math.max(0, projected - available), isBills, how };
    })
    .filter((c) => c.spent || c.billsLeft) // a category with no spending and no bills just holds its balance
    .sort((a, b) => b.over - a.over || b.projected - a.projected);
  // categories with nothing spent and no bill due are assumed to spend what they were budgeted
  const activeIds = new Set(projCats.map((c) => c.id));
  const untouched = byCategory.filter((c) => !activeIds.has(c.id) && c.budget > 0);
  const untouchedBudget = sum(untouched.map((c) => c.budget));
  const everydayProjected = sum(projCats.filter((c) => c.how === "daily").map((c) => c.projected - c.spent - c.billsLeft));
  const oneOffs = projCats.filter((c) => c.how === "one-off");
  const oneOffTopUp = sum(oneOffs.map((c) => c.projected - c.spent - c.billsLeft));
  const totalProjected = daysElapsed ? spent + billsTotal + everydayProjected + oneOffTopUp + untouchedBudget : budgeted;
  if (daysElapsed) onPace = totalProjected;
  const totalAvailable = sum(projCats.map((c) => c.available));
  const totalBudgeted = budgeted;
  const headingOver = projCats.filter((c) => c.over > 0);

  const money = (c: number) => c;
  const explainSpent: ExplainBox = {
    title: "Spent so far",
    rows: [
      ...byCategory.filter((c) => c.spent).slice(0, 6).map((c, i) => ({ k: c.name, v: money(c.spent), op: i ? "+" : "" })),
      ...(byCategory.filter((c) => c.spent).length > 6 ? [{ k: `${byCategory.filter((c) => c.spent).length - 6} more categories`, v: money(sum(byCategory.filter((c) => c.spent).slice(6).map((c) => c.spent))), op: "+" }] : []),
      { k: `Spent through day ${daysElapsed} of ${dim}`, v: money(spent), result: true },
      { k: "Budgeted = per category, the larger of what was assigned this month and what its goal needs this month", v: money(budgeted), sub: true },
    ],
    note: "Spending is every entry with a category this month, refunds netted off; transfers between accounts and card payments are not spending.",
  };
  const explainOnPace: ExplainBox = {
    title: "On pace to spend",
    rows: [
      { k: "Spent so far", v: money(spent) },
      { k: `Bills still to come (${billsToCome.length})`, v: money(billsTotal), op: "+" },
      { k: `Everyday spending so far (spent minus bills already paid ${fmt(billsSoFar)})`, v: money(everyday), sub: true },
      { k: `÷ ${daysElapsed} days elapsed = average per day`, v: fmt(Math.round(avgDaily)), sub: true },
      { k: `Everyday categories (${projCats.filter((c) => c.how === "daily").length}): their average per day × ${daysLeft} days left`, v: money(everydayProjected), op: "+" },
      { k: `One-offs (${oneOffs.length}): the rest of their budget, not extrapolated`, v: money(oneOffTopUp), op: "+" },
      { k: `Budgets of the ${untouched.length} categories with nothing spent yet`, v: money(untouchedBudget), op: "+" },
      { k: "On pace to spend", v: money(onPace), result: true },
      { k: "Budgeted", v: money(budgeted), op: "−" },
      { k: onPace > budgeted ? "Over budget if it holds" : "Under budget if it holds", v: money(Math.abs(onPace - budgeted)), result: true },
    ],
    note: "Bills are the active recurring bills. An everyday category (three or more entries so far, or spending in each of the last two months) keeps its average daily rate; a one-off lands at the larger of what it spent and its budget; a category untouched so far is assumed to spend its budget.",
  };
  const explainVs: ExplainBox = {
    title: `Vs ${monthName(prevMonth)}, same day`,
    rows: [
      { k: `This month through day ${daysElapsed}`, v: money(spent) },
      { k: `${monthName(prevMonth)} through day ${prevDay}`, v: money(prevSpent), op: "−" },
      { k: "Difference", v: money(spent - prevSpent), result: true },
      { k: `÷ ${monthName(prevMonth)}'s figure`, v: vsPct === null ? "—" : `${vsPct >= 0 ? "+" : "−"}${(Math.abs(vsPct) * 100).toFixed(1)}%`, result: true },
      ...movers.slice(0, 4).map((m) => ({ k: `${m.name}: ${fmt(m.before)} → ${fmt(m.now)}`, v: (m.delta > 0 ? "+" : "−") + fmt(Math.abs(m.delta)), sub: true })),
    ],
    note: `${monthName(prevMonth)} spent ${fmt(sum([...prevFull.values()]))} in total.`,
  };
  const explainWho: ExplainBox = r.whoSpent ? {
    title: "Whose spending",
    rows: [
      { k: "Shared: entries in the shared Classic lines (Mortgage, Groceries, Misc shared, utilities…)", v: money(owners.shared) },
      { k: "David: his Classic lines, plus his half of 50/50 entries in by-account categories", v: money(owners.D), op: "+" },
      { k: "Elizabeth: her Classic lines, plus her half of 50/50 entries", v: money(owners.E), op: "+" },
      { k: "Total", v: money(ownerTotal), result: true },
      ...(ownerTotal !== spent ? [{ k: `Spent so far differs by ${fmt(Math.abs(spent - ownerTotal))}: ${spent > ownerTotal ? "spending in categories with no Classic line isn't attributed" : "Classic counts some lines Reports doesn't treat as spending"}`, v: "", sub: true }] : []),
    ],
    note: "Follows the Classic view: a category's Classic line decides whose expense it is, whichever account paid. A by-account category goes by the payer; 50/50 splits half each.",
  } : {
    title: "Who paid",
    rows: [
      { k: "From shared accounts", v: money(owners.shared) },
      { k: "From David's accounts (+ half of 50/50 entries)", v: money(owners.D), op: "+" },
      { k: "From Elizabeth's accounts (+ half of 50/50 entries)", v: money(owners.E), op: "+" },
      { k: "Total", v: money(ownerTotal), result: true },
    ],
    note: "Who paid is the account the entry came from; a 50/50 entry counts half for each of you.",
  };
  const explainTrends: ExplainBox = {
    title: "Trends",
    rows: trendMonths.map((t) => ({ k: `${monthName(t.month)}: spent ${fmt(t.spent)}, income ${fmt(t.income)}, assigned ${fmt(t.assigned)}`, v: money(t.income - t.spent), sub: false })),
    note: "Net = income entered to Ready to Assign minus spending. The current month is to date, so its bars are still growing.",
  };
  const explainProjection: ExplainBox = {
    title: "Projection",
    rows: [
      { k: "Spent so far", v: money(spent) },
      { k: "Bills still to come", v: money(billsTotal), op: "+" },
      { k: `Everyday categories (${projCats.filter((c) => c.how === "daily").length}) at their average daily rate × ${daysLeft} days left`, v: money(everydayProjected), op: "+" },
      { k: `One-offs (${oneOffs.length}): the rest of their budget, not extrapolated`, v: money(oneOffTopUp), op: "+" },
      { k: `Budgets of the ${untouched.length} categories with nothing spent yet`, v: money(untouchedBudget), op: "+" },
      { k: "Projected spend at month end", v: money(totalProjected), result: true },
      { k: "Budgeted (assigned, or what each goal needs this month)", v: money(totalBudgeted), op: "−" },
      { k: totalProjected > totalBudgeted ? "Over budget if it holds" : "Under budget if it holds", v: money(Math.abs(totalBudgeted - totalProjected)), result: true },
      { k: "Available in these categories, carry-over included", v: money(totalAvailable), sub: true },
    ],
    note: "A category with a recurring bill counts its bills, not a daily rate. An everyday category (three or more entries so far, or spending in each of the last two months) keeps its average daily rate; a one-off is not extrapolated and lands at the larger of what it spent and its budget. A category is heading over when its projection passes what it has available, carry-over included.",
  };

  return {
    month, prevMonth, daysElapsed, daysInMonth: dim, daysLeft, isCurrent,
    thisMonth: {
      spent, budgeted, onPace,
      vsLast: { pct: vsPct, prevSpent, prevDay, summary },
      byCategory, byOwner, movers: movers.slice(0, 6), billsToCome, billsTotal,
      explain: { spent: explainSpent, onPace: explainOnPace, vsLast: explainVs, who: explainWho },
    },
    trends: { months: trendMonths.map(({ full: _f, ...t }) => t), categories: trendCategories, explain: explainTrends },
    projection: { categories: projCats, totalProjected, totalAvailable, totalBudgeted, headingOver, explain: explainProjection },
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m: MonthKey) => MONTHS[Number(m.slice(5, 7)) - 1]!;
const fmt = (c: number) => (c < 0 ? "−" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

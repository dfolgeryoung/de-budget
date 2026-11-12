/**
 * D&E Budget — database schema (Postgres via Drizzle).
 *
 * Fourteen tables carry everything; the month view is computed, never stored.
 * All money is integer cents. Every row carries created/updated timestamps and
 * the user who made the change.
 */
import {
  pgTable,
  pgEnum,
  text,
  integer,
  bigint,
  boolean,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------- enums ----------
export const accountType = pgEnum("account_type", ["checking", "savings", "credit_card"]);
export const owner = pgEnum("owner", ["D", "E", "shared"]);
export const categoryKind = pgEnum("category_kind", ["normal", "card_payment", "next_month", "savings_mirror"]);
export const classicRule = pgEnum("classic_rule", ["none", "by_account", "utilities_split", "phone_split", "drive_split"]);
export const classicSection = pgEnum("classic_section", ["recurring", "variable"]);
export const goalType = pgEnum("goal_type", ["refill_to", "set_aside"]);
export const txnSource = pgEnum("txn_source", ["manual", "recurring", "import", "migration"]);
export const bankStatus = pgEnum("bank_status", ["unchecked", "matched", "mismatch"]);
export const moveHow = pgEnum("move_how", ["move", "spread", "auto_assign", "typed", "savings_sync", "release", "reset"]);

// ---------- audit columns shared by every table ----------
const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"), // users.id
};

// ---------- users ----------
export const users = pgTable("users", {
  id: text("id").primaryKey(), // Google subject id
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  initial: text("initial").notNull(), // "D" | "E"
  avatarEmoji: text("avatar_emoji").default("🙂"),
  avatarUrl: text("avatar_url"),
  // per-person settings
  homeLayout: jsonb("home_layout").$type<{ order: string[]; hidden: string[] }>(),
  appearance: text("appearance").notNull().default("system"), // system | light | dark
  showBars: boolean("show_bars").notNull().default(true),
  sounds: boolean("sounds").notNull().default(false),
  pushRecurring: boolean("push_recurring").notNull().default(true),
  weeklyEmail: boolean("weekly_email").notNull().default(false),
  ...audit,
});

// ---------- accounts ----------
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: accountType("type").notNull(),
  onBudget: boolean("on_budget").notNull().default(true),
  owner: owner("owner").notNull().default("shared"),
  startingBalance: bigint("starting_balance", { mode: "number" }).notNull().default(0), // cents
  startingDate: date("starting_date").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  closed: boolean("closed").notNull().default(false),
  ...audit,
});

// ---------- category groups & categories ----------
export const categoryGroups = pgTable("category_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  system: boolean("system").notNull().default(false), // Credit Card Payments, One Month Ahead
  ...audit,
});

export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id").notNull().references(() => categoryGroups.id),
    name: text("name").notNull(),
    emoji: text("emoji"),
    kind: categoryKind("kind").notNull().default("normal"),
    classicBucket: text("classic_bucket"), // e.g. "Misc shared", "Groceries", "Gas", "Fun Money", or a typed line name
    classicRule: classicRule("classic_rule").notNull().default("none"),
    classicSection: classicSection("classic_section").notNull().default("variable"),
    sortOrder: integer("sort_order").notNull().default(0),
    hiddenInBudget: boolean("hidden_in_budget").notNull().default(false),
    // favourite order per user: { "<userId>": 0..n }
    favouriteOrder: jsonb("favourite_order").$type<Record<string, number>>(),
    // for card_payment categories: which account they pay
    accountId: text("account_id").references(() => accounts.id),
    // Available already in the category when the first budget month opened (from the sheet's history)
    openingAvailable: bigint("opening_available", { mode: "number" }).notNull().default(0),
    ...audit,
  },
  (t) => [uniqueIndex("categories_group_name").on(t.groupId, t.name)],
);

// ---------- settings (one row per key) ----------
export const settings = pgTable("settings", {
  key: text("key").primaryKey(), // first_month, sheet_expected, import_at, ...
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- goals (append-only by month so past months keep their goal) ----------
export const goals = pgTable(
  "goals",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id").notNull().references(() => categories.id),
    validFrom: date("valid_from").notNull(), // first day of the month it applies from
    type: goalType("type").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(), // cents
    frequencyMonths: integer("frequency_months"), // null = one-off / dated
    targetDate: date("target_date"),
    ...audit,
  },
  (t) => [uniqueIndex("goals_category_from").on(t.categoryId, t.validFrom)],
);

// ---------- transactions & lines ----------
export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    date: date("date").notNull(),
    accountId: text("account_id").notNull().references(() => accounts.id),
    payee: text("payee"),
    memo: text("memo"),
    hidden: boolean("hidden").notNull().default(false), // owner-only: others see [Hidden] and no amount
    sharedFiftyFifty: boolean("shared_fifty_fifty").notNull().default(false),
    transferToAccountId: text("transfer_to_account_id").references(() => accounts.id), // set => transfer, no lines
    amount: bigint("amount", { mode: "number" }).notNull(), // cents, signed: outflow negative, inflow positive
    bankStatus: bankStatus("bank_status").notNull().default("unchecked"),
    bankNote: text("bank_note"), // e.g. "Bank shows $218.24 on Nov 7"
    source: txnSource("source").notNull().default("manual"),
    recurringId: text("recurring_id"),
    trackedAmountId: text("tracked_amount_id"),
    confirmed: boolean("confirmed").notNull().default(true), // recurring entries wait for a confirm
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // soft delete, so Undo is cheap
    createdBy: text("created_by").references(() => users.id),
    ...audit,
  },
  (t) => [index("txn_date").on(t.date), index("txn_account_date").on(t.accountId, t.date)],
);

export const transactionLines = pgTable(
  "transaction_lines",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id), // null = Ready to Assign (income)
    amount: bigint("amount", { mode: "number" }).notNull(), // cents, signed; sum of lines = transaction amount
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("lines_txn").on(t.transactionId), index("lines_category").on(t.categoryId)],
);

// ---------- assignments (the Assigned column) ----------
export const assignments = pgTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id").notNull().references(() => categories.id),
    month: date("month").notNull(), // first day of month
    amount: bigint("amount", { mode: "number" }).notNull().default(0), // cents
    note: text("note"),
    ...audit,
  },
  (t) => [uniqueIndex("assignments_category_month").on(t.categoryId, t.month)],
);

// ---------- money moves (the log; writing a move also writes the assignment changes) ----------
export const moneyMoves = pgTable("money_moves", {
  id: text("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  month: date("month").notNull(),
  fromCategoryId: text("from_category_id").references(() => categories.id), // null = Ready to Assign
  toCategoryId: text("to_category_id").references(() => categories.id), // null = Ready to Assign
  amount: bigint("amount", { mode: "number" }).notNull(),
  how: moveHow("how").notNull(),
  byUserId: text("by_user_id").references(() => users.id),
  undone: boolean("undone").notNull().default(false),
});

// ---------- recurring bills ----------
export const recurring = pgTable("recurring", {
  id: text("id").primaryKey(),
  payee: text("payee").notNull(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  categoryId: text("category_id").references(() => categories.id),
  memo: text("memo"),
  amount: bigint("amount", { mode: "number" }).notNull(), // cents, signed
  dayOfMonth: integer("day_of_month"), // null = "sometime this month"
  active: boolean("active").notNull().default(true),
  lastCreatedMonth: date("last_created_month"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...audit,
});

// ---------- payees ----------
export const payees = pgTable("payees", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  lastCategoryId: text("last_category_id").references(() => categories.id),
  lastAccountId: text("last_account_id").references(() => accounts.id),
  hiddenDefault: boolean("hidden_default").notNull().default(false),
  ...audit,
});

// ---------- tags ----------
export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#E7F1FB"), // background; font colour is computed from luminance
  sortOrder: integer("sort_order").notNull().default(0),
  ...audit,
});

export const transactionTags = pgTable(
  "transaction_tags",
  {
    transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("transaction_tags_pk").on(t.transactionId, t.tagId)],
);

// ---------- tracked amounts (side ledger for bonuses, gifts, refunds) ----------
export const trackedAmounts = pgTable("tracked_amounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  emoji: text("emoji"),
  amount: bigint("amount", { mode: "number" }).notNull(), // cents
  receivedDate: date("received_date").notNull(),
  accountId: text("account_id").references(() => accounts.id),
  owner: owner("owner").notNull().default("shared"),
  note: text("note"),
  closed: boolean("closed").notNull().default(false),
  ...audit,
});

// ---------- imports (history of CSV reconciliations) ----------
export const imports = pgTable("imports", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  fileName: text("file_name").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  rows: integer("rows").notNull().default(0),
  matched: integer("matched").notNull().default(0),
  added: integer("added").notNull().default(0),
  mismatches: integer("mismatches").notNull().default(0),
  byUserId: text("by_user_id").references(() => users.id),
});

// ---------- push subscriptions ----------
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
  deviceLabel: text("device_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- classic: typed budgets and income per person per month ----------
export const classicMonth = pgTable(
  "classic_month",
  {
    id: text("id").primaryKey(),
    month: date("month").notNull(),
    owner: owner("owner").notNull(), // D | E | shared
    income: bigint("income", { mode: "number" }).notNull().default(0), // cents, typed
    typedBudgets: jsonb("typed_budgets").$type<Record<string, number>>(), // line name -> cents (Internet, Power, ...)
    ...audit,
  },
  (t) => [uniqueIndex("classic_month_owner").on(t.month, t.owner)],
);

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type TransactionLine = typeof transactionLines.$inferSelect;

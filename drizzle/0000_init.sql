CREATE TYPE "public"."account_type" AS ENUM('checking', 'savings', 'credit_card');--> statement-breakpoint
CREATE TYPE "public"."bank_status" AS ENUM('unchecked', 'matched', 'mismatch');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('normal', 'card_payment', 'next_month', 'savings_mirror');--> statement-breakpoint
CREATE TYPE "public"."classic_rule" AS ENUM('none', 'by_account', 'utilities_split', 'phone_split', 'drive_split');--> statement-breakpoint
CREATE TYPE "public"."classic_section" AS ENUM('recurring', 'variable');--> statement-breakpoint
CREATE TYPE "public"."goal_type" AS ENUM('refill_to', 'set_aside');--> statement-breakpoint
CREATE TYPE "public"."move_how" AS ENUM('move', 'spread', 'auto_assign', 'typed', 'savings_sync', 'release', 'reset');--> statement-breakpoint
CREATE TYPE "public"."owner" AS ENUM('D', 'E', 'shared');--> statement-breakpoint
CREATE TYPE "public"."txn_source" AS ENUM('manual', 'recurring', 'import', 'migration');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"on_budget" boolean DEFAULT true NOT NULL,
	"owner" "owner" DEFAULT 'shared' NOT NULL,
	"starting_balance" bigint DEFAULT 0 NOT NULL,
	"starting_date" date NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "accounts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"month" date NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"kind" "category_kind" DEFAULT 'normal' NOT NULL,
	"classic_bucket" text,
	"classic_rule" "classic_rule" DEFAULT 'none' NOT NULL,
	"classic_section" "classic_section" DEFAULT 'variable' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"hidden_in_budget" boolean DEFAULT false NOT NULL,
	"favourite_order" jsonb,
	"account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "category_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "category_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "classic_month" (
	"id" text PRIMARY KEY NOT NULL,
	"month" date NOT NULL,
	"owner" "owner" NOT NULL,
	"income" bigint DEFAULT 0 NOT NULL,
	"typed_budgets" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"valid_from" date NOT NULL,
	"type" "goal_type" NOT NULL,
	"amount" bigint NOT NULL,
	"frequency_months" integer,
	"target_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"mismatches" integer DEFAULT 0 NOT NULL,
	"by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "money_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"month" date NOT NULL,
	"from_category_id" text,
	"to_category_id" text,
	"amount" bigint NOT NULL,
	"how" "move_how" NOT NULL,
	"by_user_id" text,
	"undone" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payees" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"last_category_id" text,
	"last_account_id" text,
	"hidden_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "payees_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "recurring" (
	"id" text PRIMARY KEY NOT NULL,
	"payee" text NOT NULL,
	"account_id" text NOT NULL,
	"category_id" text,
	"memo" text,
	"amount" bigint NOT NULL,
	"day_of_month" integer,
	"active" boolean DEFAULT true NOT NULL,
	"last_created_month" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#E7F1FB' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tracked_amounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"amount" bigint NOT NULL,
	"received_date" date NOT NULL,
	"account_id" text,
	"owner" "owner" DEFAULT 'shared' NOT NULL,
	"note" text,
	"closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "transaction_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"category_id" text,
	"amount" bigint NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_tags" (
	"transaction_id" text NOT NULL,
	"tag_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"account_id" text NOT NULL,
	"payee" text,
	"memo" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"shared_fifty_fifty" boolean DEFAULT false NOT NULL,
	"transfer_to_account_id" text,
	"amount" bigint NOT NULL,
	"bank_status" "bank_status" DEFAULT 'unchecked' NOT NULL,
	"bank_note" text,
	"source" "txn_source" DEFAULT 'manual' NOT NULL,
	"recurring_id" text,
	"tracked_amount_id" text,
	"confirmed" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"initial" text NOT NULL,
	"avatar_emoji" text DEFAULT '🙂',
	"avatar_url" text,
	"home_layout" jsonb,
	"appearance" text DEFAULT 'system' NOT NULL,
	"show_bars" boolean DEFAULT true NOT NULL,
	"sounds" boolean DEFAULT false NOT NULL,
	"push_recurring" boolean DEFAULT true NOT NULL,
	"weekly_email" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_group_id_category_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."category_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_moves" ADD CONSTRAINT "money_moves_from_category_id_categories_id_fk" FOREIGN KEY ("from_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_moves" ADD CONSTRAINT "money_moves_to_category_id_categories_id_fk" FOREIGN KEY ("to_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_moves" ADD CONSTRAINT "money_moves_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_last_category_id_categories_id_fk" FOREIGN KEY ("last_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_last_account_id_accounts_id_fk" FOREIGN KEY ("last_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_amounts" ADD CONSTRAINT "tracked_amounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_to_account_id_accounts_id_fk" FOREIGN KEY ("transfer_to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_category_month" ON "assignments" USING btree ("category_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_group_name" ON "categories" USING btree ("group_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "classic_month_owner" ON "classic_month" USING btree ("month","owner");--> statement-breakpoint
CREATE UNIQUE INDEX "goals_category_from" ON "goals" USING btree ("category_id","valid_from");--> statement-breakpoint
CREATE INDEX "lines_txn" ON "transaction_lines" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "lines_category" ON "transaction_lines" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_tags_pk" ON "transaction_tags" USING btree ("transaction_id","tag_id");--> statement-breakpoint
CREATE INDEX "txn_date" ON "transactions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "txn_account_date" ON "transactions" USING btree ("account_id","date");
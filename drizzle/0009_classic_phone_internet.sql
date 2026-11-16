-- The Classic "Internet" line is really the Phone & Internet category: rename it wherever its name is stored.
UPDATE "settings" SET "value" = replace("value"::text, '"name":"Internet"', '"name":"Phone & Internet"')::jsonb, "updated_at" = now() WHERE "key" IN ('classic_layout', 'classic_expected');
UPDATE "classic_month" SET "typed_budgets" = ("typed_budgets" - 'Internet') || jsonb_build_object('Phone & Internet', "typed_budgets"->'Internet') WHERE "typed_budgets" ? 'Internet' AND NOT ("typed_budgets" ? 'Phone & Internet');

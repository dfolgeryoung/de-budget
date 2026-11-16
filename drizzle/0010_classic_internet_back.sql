-- Reverse 0009: the Classic line goes back to "Internet".
UPDATE "settings" SET "value" = replace("value"::text, '"name":"Phone & Internet"', '"name":"Internet"')::jsonb, "updated_at" = now() WHERE "key" IN ('classic_layout', 'classic_expected');
UPDATE "classic_month" SET "typed_budgets" = ("typed_budgets" - 'Phone & Internet') || jsonb_build_object('Internet', "typed_budgets"->'Phone & Internet') WHERE "typed_budgets" ? 'Phone & Internet' AND NOT ("typed_budgets" ? 'Internet');

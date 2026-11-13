ALTER TABLE "recurring" ADD COLUMN "every_days" integer;--> statement-breakpoint
ALTER TABLE "recurring" ADD COLUMN "anchor_date" date;--> statement-breakpoint
ALTER TABLE "recurring" ADD COLUMN "last_created_date" date;
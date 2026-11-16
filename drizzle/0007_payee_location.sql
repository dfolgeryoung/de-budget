ALTER TABLE "payees" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "fixes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "use_location" boolean DEFAULT false NOT NULL;
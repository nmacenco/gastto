DROP INDEX IF EXISTS "uq_user_spreadsheet";--> statement-breakpoint
ALTER TABLE "spreadsheet_configs" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "spreadsheet_configs" ADD COLUMN "header_row_index" integer;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_active_spreadsheet" ON "spreadsheet_configs" USING btree ("user_id") WHERE "spreadsheet_configs"."is_active" = true;
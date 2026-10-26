CREATE TABLE IF NOT EXISTS "user_payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spreadsheet_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_records" ADD COLUMN "payment_method_id" uuid;--> statement-breakpoint
ALTER TABLE "spreadsheet_configs" ADD COLUMN "payment_methods_confirmed_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_payment_methods" ADD CONSTRAINT "user_payment_methods_spreadsheet_id_spreadsheet_configs_id_fk" FOREIGN KEY ("spreadsheet_id") REFERENCES "public"."spreadsheet_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_payment_methods_spreadsheet" ON "user_payment_methods" USING btree ("spreadsheet_id") WHERE "user_payment_methods"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_spreadsheet_payment_method" ON "user_payment_methods" USING btree ("spreadsheet_id","normalized_name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_payment_method_id_user_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."user_payment_methods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_records_payment_method" ON "expense_records" USING btree ("payment_method_id");
CREATE TABLE IF NOT EXISTS "user_subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"raw_value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_records" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_records" ADD COLUMN "subcategory_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_records" ADD COLUMN "subcategoria" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_subcategories" ADD CONSTRAINT "user_subcategories_category_id_user_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."user_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_subcategories_category" ON "user_subcategories" USING btree ("category_id") WHERE "user_subcategories"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_category_subcategory" ON "user_subcategories" USING btree ("category_id","normalized_value");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_category_id_user_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."user_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_subcategory_id_user_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."user_subcategories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_records_category" ON "expense_records" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_records_subcategory" ON "expense_records" USING btree ("subcategory_id");
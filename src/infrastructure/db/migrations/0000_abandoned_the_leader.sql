CREATE TABLE IF NOT EXISTS "column_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spreadsheet_id" uuid NOT NULL,
	"gastto_field" text NOT NULL,
	"column_index" smallint NOT NULL,
	"column_header" text NOT NULL,
	"inferred" boolean DEFAULT true NOT NULL,
	"confirmed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_states" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_state" text DEFAULT 'IDLE' NOT NULL,
	"state_payload" jsonb,
	"entered_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"raw_message" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"channel" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"spreadsheet_id" uuid NOT NULL,
	"concepto" text NOT NULL,
	"monto" numeric(14, 2) NOT NULL,
	"moneda" text NOT NULL,
	"categoria" text,
	"fecha_gasto" date NOT NULL,
	"medio_pago" text,
	"sheet_name" text NOT NULL,
	"row_index" integer NOT NULL,
	"categoria_confidence" text,
	"raw_message" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"saved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messaging_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"access_token_enc" "bytea" NOT NULL,
	"refresh_token_enc" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"access_token_expires_at" timestamp NOT NULL,
	"scope" text[] DEFAULT '{}' NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"last_refreshed_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"payload" jsonb,
	"error_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spreadsheet_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"file_id" text NOT NULL,
	"file_name" text NOT NULL,
	"sheet_name" text NOT NULL,
	"access_verified_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spreadsheet_id" uuid NOT NULL,
	"raw_value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"default_currency" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "column_mappings" ADD CONSTRAINT "column_mappings_spreadsheet_id_spreadsheet_configs_id_fk" FOREIGN KEY ("spreadsheet_id") REFERENCES "public"."spreadsheet_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_queue" ADD CONSTRAINT "expense_queue_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_spreadsheet_id_spreadsheet_configs_id_fk" FOREIGN KEY ("spreadsheet_id") REFERENCES "public"."spreadsheet_configs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messaging_identities" ADD CONSTRAINT "messaging_identities_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spreadsheet_configs" ADD CONSTRAINT "spreadsheet_configs_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_categories" ADD CONSTRAINT "user_categories_spreadsheet_id_spreadsheet_configs_id_fk" FOREIGN KEY ("spreadsheet_id") REFERENCES "public"."spreadsheet_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_column_mappings_spreadsheet" ON "column_mappings" USING btree ("spreadsheet_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_spreadsheet_field" ON "column_mappings" USING btree ("spreadsheet_id","gastto_field");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_spreadsheet_column" ON "column_mappings" USING btree ("spreadsheet_id","column_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversation_states_expires" ON "conversation_states" USING btree ("expires_at") WHERE "conversation_states"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversation_states_current" ON "conversation_states" USING btree ("current_state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_queue_user_position" ON "expense_queue" USING btree ("user_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_position" ON "expense_queue" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_records_user_latest" ON "expense_records" USING btree ("user_id","saved_at") WHERE "expense_records"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_records_user_fecha" ON "expense_records" USING btree ("user_id","fecha_gasto") WHERE "expense_records"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_records_sheet_row" ON "expense_records" USING btree ("spreadsheet_id","sheet_name","row_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messaging_identities_lookup" ON "messaging_identities" USING btree ("channel","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messaging_identities_user" ON "messaging_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_channel_external" ON "messaging_identities" USING btree ("channel","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_user_provider" ON "oauth_tokens" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_expires" ON "oauth_tokens" USING btree ("access_token_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_provider" ON "oauth_tokens" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_operation_logs_user_created" ON "operation_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_operation_logs_failures" ON "operation_logs" USING btree ("created_at") WHERE "operation_logs"."operation" = 'EXPENSE_SAVE_FAILED';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_spreadsheet_configs_user" ON "spreadsheet_configs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_spreadsheet" ON "spreadsheet_configs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_categories_spreadsheet" ON "user_categories" USING btree ("spreadsheet_id") WHERE "user_categories"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_spreadsheet_category" ON "user_categories" USING btree ("spreadsheet_id","normalized_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_status" ON "users" USING btree ("status");
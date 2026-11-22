CREATE TABLE "account_deletion_identities" (
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_deletion_operations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"stage" text DEFAULT 'blocked' NOT NULL,
	"remote_revocation_failed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_account_deletion_operations_stage" CHECK ("account_deletion_operations"."stage" IN ('blocked','revoking','cleaning','notifying'))
);
--> statement-breakpoint
ALTER TABLE "account_deletion_identities" ADD CONSTRAINT "account_deletion_identities_user_id_account_deletion_operations_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_deletion_operations"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_deletion_identities_owner" ON "account_deletion_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_account_deletion_identity" ON "account_deletion_identities" USING btree ("channel","external_id");--> statement-breakpoint
CREATE INDEX "idx_account_deletion_operations_stage" ON "account_deletion_operations" USING btree ("stage");
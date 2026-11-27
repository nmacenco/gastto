CREATE TABLE "candidate_oauth_tokens" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token_enc" "bytea" NOT NULL,
	"refresh_token_enc" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"refresh_iv" "bytea" NOT NULL,
	"access_token_expires_at" timestamp NOT NULL,
	"scope" text[] DEFAULT '{}' NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"last_refreshed_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "candidate_oauth_tokens" ADD CONSTRAINT "candidate_oauth_tokens_request_id_access_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."access_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_oauth_tokens" ADD CONSTRAINT "candidate_oauth_tokens_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_candidate_oauth_tokens_user" ON "candidate_oauth_tokens" USING btree ("user_id");
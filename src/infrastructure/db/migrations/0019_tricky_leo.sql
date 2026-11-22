CREATE TABLE "account_start_replays" (
	"digest" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_account_start_replays_expiry" ON "account_start_replays" USING btree ("expires_at");
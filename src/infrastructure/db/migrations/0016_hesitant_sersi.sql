CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	"decided_by" text,
	"activated_at" timestamp,
	"notification_sent_at" timestamp,
	"approval_notice_sent_at" timestamp,
	CONSTRAINT "chk_access_requests_kind" CHECK ("access_requests"."kind" IN ('initial', 'replacement')),
	CONSTRAINT "chk_access_requests_status" CHECK ("access_requests"."status" IN ('pending', 'approved', 'superseded'))
);
--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_access_requests_user_status" ON "access_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_access_requests_pending_user" ON "access_requests" USING btree ("user_id") WHERE "access_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_access_requests_active_user" ON "access_requests" USING btree ("user_id") WHERE "access_requests"."status" = 'approved' AND "access_requests"."activated_at" IS NOT NULL;

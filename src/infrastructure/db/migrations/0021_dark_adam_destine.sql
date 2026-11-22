CREATE TABLE "redis_recovery_epoch" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"epoch" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "chk_redis_recovery_epoch_singleton" CHECK ("redis_recovery_epoch"."id" = 1),
	CONSTRAINT "chk_redis_recovery_epoch_nonnegative" CHECK ("redis_recovery_epoch"."epoch" >= 0)
);

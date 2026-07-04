# 2026_05_17-deploy_flyio_and_configure_telegram_webhook

## Goal

Deploy the Gastto application to Fly.io (already done) and configure the Telegram Bot webhook to point to the production HTTPS endpoint, verifying it is active.

## Context

- **Already deployed**: `fly.toml` exists, app `gastto` is live at `https://gastto.fly.dev/health` (returns 200).
- **Dockerfile**: Already created with `pnpm`, `PORT=8080`, production build.
- **Webhook endpoint**: `src/interfaces/http/routes/telegram.webhook.ts` handles `POST /webhook/telegram` with secret validation via `X-Telegram-Bot-Api-Secret-Token`.
- **Auth middleware**: `src/interfaces/http/middleware/telegramAuth.ts` validates the secret token.
- **Env schema**: `src/config/env.schema.ts` defines `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` as optional (for skeleton phase).
- **AGENTS.md**: See `docs/plans/plan-conventions.md` for plan structure and `docs/architecture/config-env.md` for environment variable conventions.

## Phases

### Phase 1: Verify Fly.io deployment and secrets

- [x] Verify Fly.io app status (`flyctl status`).
- [x] Verify required secrets are set (`flyctl secrets list`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `DATABASE_URL`, `REDIS_URL`.
- [x] If secrets are missing, set them via `flyctl secrets set`.
- [x] Verify `/health` endpoint returns `{ "status": "ok" }`.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify no issues.
- [x] Ask the user if they want to review before continuing.

### Phase 2: Configure Telegram webhook and verify

- [x] Call Telegram Bot API `setWebhook` with production URL `https://gastto.fly.dev/webhook/telegram` and `secret_token`.
- [x] Verify response contains `"ok": true`.
- [x] Call `getWebhookInfo` to confirm webhook is active, URL is correct, and uses HTTPS.
- [x] Update `docs/user-stories/.../T-0.01-04.md` acceptance criteria checkboxes.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify no issues.
- [x] Ask the user if they want to review before continuing.

## Public contracts

No changes to application services, domain events, database schemas, or UI text.
The only modified file will be the task markdown `T-0.01-04.md` (acceptance criteria checkboxes).

## Next step

Plan completed. All acceptance criteria for T-0.01-04 have been verified.

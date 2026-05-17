# Plan: Register Telegram bot and secure API token

## Goal

Register the Gastto Telegram bot via BotFather, obtain the API token, and wire it into the project's environment configuration system. Ensure the token is never committed to version control and is available for subsequent tasks (T-0.01-04 webhook setup, T-0.01-05 welcome message, HU-0.03 message sending).

## Context

| File / Directory                    | Relevance                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `src/config/env.schema.ts:29`       | Current env schema - has `TELEGRAM_WEBHOOK_SECRET` but no `TELEGRAM_BOT_TOKEN` |
| `src/config/env.spec.ts`            | Zod schema contract tests - 6 test cases, needs 7th for new var                |
| `src/config/env.ts`                 | Runtime parser - auto-loads schema, no changes needed                          |
| `.gitignore:69-71`                  | Already blocks `.env`, `.env.*`, allows `.env.example`                         |
| `.env`                              | Exists locally with `TELEGRAM_WEBHOOK_SECRET`; no bot token yet                |
| `.env.example`                      | Does not exist - needs creation                                                |
| `docs/architecture/config-env.md`   | Configuration docs template - needs env var table populated                    |
| `docs/plans/plan-conventions.md`    | Plan structure rules                                                           |
| `AGENTS.md`                         | Architecture overview, conventions, DSL                                        |
| `docs/user-stories/.../HU-0.01*.md` | User story context - bot registration + webhook                                |

**Key distinction**: `TELEGRAM_BOT_TOKEN` (Bot API auth) is not the same as `TELEGRAM_WEBHOOK_SECRET` (webhook origin validation). Both are needed.

## Phases

### Phase 1: Add `TELEGRAM_BOT_TOKEN` to config + register bot

**Description**: Extend the Zod env schema with the new variable, add contract test coverage, and execute the operational BotFather registration. Token stored in `.env` (gitignored).

**Public contracts modified**:

- `src/config/env.schema.ts` - new env var: `TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required').optional()`
- `src/config/env.spec.ts` - new test case verifying `TELEGRAM_BOT_TOKEN` passes validation

**Public contracts NOT affected**: Application services, domain events, DB schemas, text copies.

**To-do actions**:

- [x] Add `TELEGRAM_BOT_TOKEN` to `envSchema` in `src/config/env.schema.ts` under Messaging section (line 29)
- [x] Add `TELEGRAM_BOT_TOKEN: 'test-bot-token'` to `validEnv` fixture in `src/config/env.spec.ts`
- [x] Add test case in `src/config/env.spec.ts` verifying `TELEGRAM_BOT_TOKEN` is accepted when present and `undefined` when absent
- [x] Run `npx vitest run src/config/env.spec.ts` to confirm all 7 tests pass
- [ ] **Operational**: Register bot with BotFather (`/newbot`), capture definitive name, username, API token
- [ ] Store token in `.env` as `TELEGRAM_BOT_TOKEN=<token>` (file is gitignored, lines 69-71 of `.gitignore`)
- [x] Verify no secret in git tracking: `git status` shows `.env` unchanged/modified but never staged
- [x] Run `pnpm lint && pnpm typecheck` to verify no regressions
- [x] Ask user: review changes or proceed to Phase 2?

### Phase 2: Create `.env.example` + document secrets

**Description**: Create a developer onboarding template for env vars and document the secret management flow for Fly.io deployment.

**Public contracts modified**:

- `.env.example` - new file with all env vars as empty-value placeholders

**To-do actions**:

- [x] Create `.env.example` with all env vars from `env.schema.ts`, each with empty value and comment describing purpose
- [x] Verify `.env.example` is NOT gitignored (`.gitignore:71` already has `!.env.example`)
- [x] Update `docs/architecture/config-env.md` with env var table listing all variables, scope (Server), required status, descriptions
- [x] Document Fly.io secrets command in config-env.md: `flyctl secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<secret>`
- [x] Run `pnpm lint && pnpm typecheck` - no code changes in this phase, but verify no drift
- [x] Ask user: confirm plan complete? Or execute code changes?

## Next step

All phases complete. Commit the changes and suggest the user export this conversation as `2026_05_17-telegram_bot_registration_token_secure-conversation.md` alongside the plan.

# Local Docker stack with hot reload

## Goal

Start Gastto, PostgreSQL, Redis, database migrations, and the Telegram HTTPS tunnel with one Docker Compose command after one-time external credential setup. Keep application source changes visible through hot reload without rebuilding the image, and document the actual Google OAuth setup required for onboarding.

## Context

- [AGENTS.md](../../../AGENTS.md): documentation, database, security, and verification rules. Do not read local secret files or modify existing migrations.
- [Plan conventions](../../../docs/plans/plan-conventions.md): vertical slices, phase checks, and review gates.
- [ADR index](../../../docs/adr/adr.md), especially ADR-003, ADR-005, ADR-007, ADR-009, ADR-010, and ADR-016: PostgreSQL conversation state, Redis queues, encrypted OAuth credentials, persistent Fastify runtime, deployment separation, and bootstrap.
- [Current Compose file](../../../docker-compose.yml): only Redis is defined. The `redis:*` package scripts currently use this file.
- [Production Dockerfile](../../../Dockerfile): its runner has neither pnpm nor Drizzle Kit. Keep the production build and Fly.io configuration outside the local-stack change.
- [Drizzle configuration](../../../drizzle.config.ts) and [migration directory](../../../src/infrastructure/db/migrations): migrations must run before the local app accepts traffic. Do not generate or edit schema migrations for this infrastructure change.
- [Environment template](../../../.env.example), [environment schema](../../../src/config/env.schema.ts), [bootstrap](../../../src/main.ts), and [worker registration](../../../src/bootstrap/registerWorkers.ts): database, Redis, Telegram, Google, LLM, and encryption settings are startup inputs; Telegram registers its webhook from `WEBHOOK_BASE_URL` during startup.
- [Local setup guide](../../../docs/development/local-setup.md), [configuration reference](../../../docs/architecture/config-env.md), [cloud connection feature](../../../docs/features/cloud-storage-connection.md), and [Telegram access approval](../../../docs/features/telegram-access-approval.md): current instructions assume shared Supabase; Google OAuth links a user's Drive and Sheets account, while operator Gmail approval is an optional separate feature.
- [Google OAuth adapter](../../../src/infrastructure/adapters/oauth/GoogleDriveOAuthAdapter.ts): the requested scopes are `drive.readonly` and `spreadsheets`; the local guide currently names `drive.file`.
- External one-time inputs still required: a dedicated local Telegram bot, an ngrok account authtoken and account-assigned development domain, a Google OAuth client and test user, at least one LLM provider key, and a generated encryption key. Never commit these values.

## Execution and validation boundaries

- This document authorizes planning only. Implement the phases only after an explicit implementation request.
- Automated checks may validate Compose structure without printing resolved secrets, build the development image, run lint/typecheck/tests, and exercise disposable local infrastructure using non-sensitive test configuration. Never read `.env` or other secret files.
- Before credential-backed database commands, follow AGENTS.md: ask the user to run them or confirm the specific credential use. Confirm the target is the isolated Compose PostgreSQL service; never run these checks against shared infrastructure.
- The user supplies external credentials through the ignored environment workflow and performs Google consent and Telegram interaction. Record these checks as pending until observed; a successful build or `/health` response does not establish end-to-end success.

## Phases

### Phase 1: Runnable local core with source hot reload

Description: Provide an isolated local Compose stack that can start and serve `/health` using a new PostgreSQL database, Redis, applied migrations, and a watching application process. This phase must work without changing production deployment artifacts or the existing Redis-only Compose workflow.

Public contracts: add the documented command `docker compose -f compose.local.yml up --build`; add local-only Compose inputs for the PostgreSQL database/user/password and construct service-network `DATABASE_URL` and `REDIS_URL` for the app. Keep current HTTP routes and database schema unchanged.

- [x] Add `compose.local.yml` with explicit project name `gastto-local`, PostgreSQL, Redis, a one-shot Drizzle migration service, and the app. Use project-scoped networks and named volumes; avoid fixed container names and external/shared volumes. A different Compose filename alone does not isolate the project from the existing Redis workflow.
- [x] Gate migrations on PostgreSQL health and app startup on successful migration completion plus Redis health. Publish the app on `127.0.0.1:3000`; keep PostgreSQL and Redis internal by default. Document an explicit optional host-access override if needed, avoiding collisions with the existing Redis service.
- [x] Add a separate `Dockerfile.dev` that contains Node 24, pnpm 10.34.9, `tsx`, and Drizzle Kit. Run `pnpm dev` with source bind mounts and container-owned dependencies so editing `src/` restarts the server without rebuilding. Preserve the production Dockerfile and Fly.io behavior. Bind only required source/configuration paths, keeping image-installed `node_modules` outside host mounts; avoid a persistent dependency volume that masks rebuilt dependencies.
- [x] Define lifecycle commands: source edits reload automatically; dependency/lockfile changes require rebuilding and recreating the app and migration image consumers; environment changes require container recreation; migration changes require rerunning the migration service before the app. Do not imply `restart` or hot reload applies new environment values, dependencies, or migrations.
- [x] Supply local database and broker URLs from Compose service names rather than the old shared Supabase URL. Ensure the app and migration service use the same local PostgreSQL credentials and migration directory.
- [x] Validate a clean-volume startup, completed migrations, `/health`, a source edit triggering reload, restart persistence, and a failed migration preventing app startup. Exercise failure with disposable local fixtures or a controlled failing migration command, without editing committed migrations. Check migration state and worker initialization separately: the current bootstrap can serve HTTP after infrastructure errors. Do not run `db:migrate` against shared or production infrastructure.
- [x] Validate coexistence with the Redis-only workflow, including independent stop/reset operations and absence of shared volumes or port collisions.
- [x] Publish minimum runnable instructions in `local-setup.md` in this phase: required environment inputs, start, inspect status, stop, restart, dependency refresh, and an explicitly destructive local-volume reset scoped to `gastto-local`. Explain that phase 1 uses `WEBHOOK_BASE_URL=http://localhost:3000` and still needs the required application configuration; Telegram delivery is introduced in phase 2.
- [x] Run `pnpm test` and fix relevant failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Telegram tunnel in the same local command

Description: Make the same Compose command start an ngrok agent that forwards the public HTTPS endpoint to the app. Use the account's stable development domain, which avoids discovering and persisting a changing URL at runtime.

Public contracts: add `NGROK_AUTHTOKEN` and a local HTTPS `WEBHOOK_BASE_URL` to the ignored `.env` workflow; the same URL configures the ngrok endpoint and the existing app webhook registration. No Telegram route or payload contract changes.

- [x] Add an ngrok service to the local Compose file, forwarding to `app:3000` and binding the configured development domain. Keep its authtoken in the local `.env`; do not put secrets in the image, committed Compose defaults, command-line output, or logs.
- [x] Validate that the configured URL is an HTTPS origin for the assigned development domain, without a path, query, or fragment. Distinguish ngrok agent readiness from upstream app reachability. Start the agent independently of app HTTP health; any app dependency on ngrok must check only agent connection/endpoint availability, never a successful request through the app.
- [ ] Preserve the current webhook registration sequence and localhost skip behavior. Registration currently occurs before `app.listen()` and registration errors are logged without stopping startup. After the app listens, verify public endpoint reachability, `getWebhookInfo`, and actual message delivery. Use bounded waits with clear diagnostics; never introduce an app/tunnel readiness cycle or claim that container startup guarantees delivery.
- [x] Document the explicit non-tunneled command/configuration alongside the default all-services command so local core work remains possible without starting ngrok.
- [x] Document that the local bot must have its own token: registering the same bot from a laptop would replace the deployed environment's webhook.
- [ ] Verify startup with the tunnel, successful Telegram `getWebhookInfo` for the local bot, a test message through the local route, and a clear failure when the ngrok credential or domain is invalid. Do not use a production or staging bot for this check.
- [x] Run `pnpm test` and fix relevant failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Accurate first-run guide and deployment boundary

Description: Make installation and execution instructions match the local stack and clarify which external accounts are still required. A new developer should be able to follow the guide from an empty local volume and reach a working Telegram-to-Google onboarding flow.

Public contracts: update the published local setup command and `.env.example` variable descriptions; explain the Google OAuth callback and actual requested scopes. Keep production secrets, Fly.io deployment commands, HTTP routes, and data schema unchanged.

- [x] Rewrite [local-setup.md](../../../docs/development/local-setup.md) around the one-time `.env` setup and the single Compose start command, including startup checks, hot reload, stop/restart, safe local-volume reset, and the fact that no hosted PostgreSQL project is needed.
- [x] Explain the Google Cloud project, enabled Drive and Sheets APIs, OAuth consent screen, test users, Web application client, two callback options, current `drive.readonly` and `spreadsheets` scopes, and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. State that this is Drive/Sheets authorization during Telegram onboarding, not an independent website login.
- [ ] Document callback selection explicitly: `http://localhost:3000/auth/google/callback` requires completing consent in a browser on the Docker host; mobile Telegram users must use `https://<assigned-development-domain>/auth/google/callback`. Set `GOOGLE_REDIRECT_URI` and the Google client's authorized redirect URI to the exact chosen value. Clarify that `app:3000` is an internal Docker address, never a browser callback. Validate both documented paths, with user-performed consent, before marking them verified.
- [x] Describe the optional `ACCESS_APPROVAL_ENABLED=true` operator Gmail setup separately; the default local flow must not require operator Gmail credentials.
- [x] Update [README.md](../../../README.md), [.env.example](../../../.env.example), and [config-env.md](../../../docs/architecture/config-env.md) to remove the Supabase-only local assumption, align Node 24, and distinguish host URLs from container-network URLs. Update any affected feature documentation and its `docs/features/README.md` index if feature documentation changes.
- [x] Record the local topology decision in a new ADR if the implementation introduces a lasting architectural trade-off; update `docs/adr/README.md` alongside any new ADR. No ADR was needed: the change is a local development workflow and does not alter deployed architecture or contracts.
- [ ] Follow the guide from a clean checkout and empty volumes, checking migration success, HTTP health, worker operation, Telegram delivery and response, Google callback, and hot reload. Record automated results separately from user-performed credential-backed checks, and leave unavailable checks explicitly pending. Recheck that existing Fly.io configuration and production Docker build remain unchanged.
- [x] Run `pnpm test` and fix relevant failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Complete the pending credential-backed Telegram and Google checks for Phases 2 and 3 using a dedicated local bot and test account.

# Goal

Update the deployment infrastructure to support automatic, branch-based deploys to Fly.io for both production (`main`) and development (`develop`) environments. Replace the single-stage Dockerfile with an optimized multi-stage build using pnpm, align the exposed port with the application default (3000), and optimize Fly.io resources for the free tier.

# Context

- `Dockerfile`: Currently single-stage, uses `pnpm`, exposes port `8080`. Should be converted to multi-stage to reduce image size and exclude dev dependencies.
- `fly.toml`: References port `8080`, requests `1gb` RAM (redundant with `memory_mb = 1024`), sets `auto_stop_machines = 'stop'` and `min_machines_running = 0`. Needs alignment with the application's `PORT` default.
- `.github/workflows/fly-deploy.yml`: Triggers only on `main` and uses a single Fly.io app/token.
- `src/config/env.schema.ts`: `PORT` defaults to `3000`. If Fly.io does not inject `PORT=8080`, the app binds to `3000` while Fly.io routes to `8080`, causing a deployment failure.
- `docs/adr/adr.md` (ADR-009): Defines Gastto as a persistent Fastify server on Fly.io. Notes that `Dockerfile` is the expected deploy artifact. BullMQ workers will require `auto_stop_machines = false` in the future.
- `pnpm-workspace.yaml`: Must be copied during Docker build for pnpm to resolve workspace settings.

# Phases

## Phase 1: Multi-stage Dockerfile with pnpm and unified port

Rewrite the Dockerfile as a multi-stage build. The builder stage installs all dependencies (including dev) and runs `pnpm build`. The runner stage copies only the compiled `dist/` directory and installs production dependencies. Align `EXPOSE` and the default `PORT` env to `3000` to match `env.schema.ts`.

- [x] Remove the existing single-stage `Dockerfile`.
- [x] Create a multi-stage `Dockerfile` with `builder` and `runner` stages based on `node:20-alpine`.
- [x] Copy `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` before installing dependencies to leverage layer caching.
- [x] Use `pnpm install --frozen-lockfile` in the builder stage.
- [x] Run `pnpm build` in the builder stage to produce `dist/main.js`.
- [x] In the runner stage, install only production dependencies with `pnpm install --prod --frozen-lockfile`.
- [x] Copy the `dist/` folder from the builder stage to the runner stage.
- [x] Set `ENV NODE_ENV=production` and `ENV PORT=3000`.
- [x] Set `EXPOSE 3000` and `CMD ["node", "dist/main.js"]`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 2: Production `fly.toml` optimization

Update the production configuration to use the unified port, reduce memory to the free-tier limit, and disable the redundant memory field. Keep `auto_stop_machines = true` because BullMQ workers are not yet running. Update the primary region to `mad` for lower latency.

- [x] Update `app = 'gastto'`.
- [x] Update `primary_region = 'mad'`.
- [x] Under `[env]`, set `NODE_ENV = "production"` and `PORT = "3000"`.
- [x] Update `[http_service]` `internal_port` to `3000`.
- [x] Set `auto_stop_machines = true` (safe without BullMQ workers).
- [x] Set `min_machines_running = 0`.
- [x] Update `[[vm]]` to `memory = '256mb'`, `cpu_kind = 'shared'`, `cpus = 1`.
- [x] Remove the redundant `memory_mb = 1024` line.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 3: Development `fly.develop.toml`

Create a separate Fly.io configuration for the development environment. It targets a new app (`gastto-develop`) with `NODE_ENV = "development"` and identical resource limits. This enables isolated staging deploys.

- [x] Create `fly.develop.toml` in the project root.
- [x] Set `app = 'gastto-develop'`.
- [x] Set `primary_region = 'mad'`.
- [x] Under `[env]`, set `NODE_ENV = "development"` and `PORT = "3000"`.
- [x] Configure `[http_service]` with `internal_port = 3000`, `auto_stop_machines = true`, `auto_start_machines = true`, `min_machines_running = 0`.
- [x] Configure `[[vm]]` with `memory = '256mb'`, `cpu_kind = 'shared'`, `cpus = 1`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 4: GitHub Actions dual-environment workflow

Update the existing workflow to trigger on both `main` and `develop` branches. Use conditional steps to deploy to the correct Fly.io app and configuration file. Document the required secrets.

- [x] Update `.github/workflows/fly-deploy.yml` to trigger on `push` to `main` and `develop`.
- [x] Add a conditional step for production: `if: github.ref == 'refs/heads/main'` running `flyctl deploy --config fly.toml --remote-only` with `FLY_API_TOKEN`.
- [x] Add a conditional step for development: `if: github.ref == 'refs/heads/develop'` running `flyctl deploy --config fly.develop.toml --remote-only` with `FLY_API_TOKEN_DEVELOP`.
- [x] Keep `concurrency: deploy-group` to prevent concurrent deploys.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 5: Validation and local build verification

Verify the new Dockerfile builds locally and measure the resulting image size improvement.

- [x] Run `docker build -t gastto:test .` locally to ensure the multi-stage build completes without errors.
- [x] Verify the final image size is significantly smaller than the previous single-stage build.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 6: Deployment operations documentation

Create a comprehensive deployment guide that documents the complete manual setup required for the multi-environment infrastructure, including secrets management and Telegram bot isolation.

- [x] Create `docs/features/deployment.md` documenting the following operational procedures:
  - How to create the `gastto-develop` app in Fly.io via `flyctl apps create gastto-develop`.
  - Complete list of secrets that must be configured per environment (`DATABASE_URL`, `REDIS_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `ENCRYPTION_KEY`).
  - Commands to set secrets on each Fly.io app (`flyctl secrets set --app gastto ...` and `flyctl secrets set --app gastto-develop ...`).
  - Instructions to create the development Telegram bot via @BotFather and register its webhook URL for the `gastto-develop` app.
  - GitHub repository secrets configuration: `FLY_API_TOKEN` (for production) and `FLY_API_TOKEN_DEVELOP` (for staging).
  - Branch-to-environment mapping: `main` branch deploys to `gastto`, `develop` branch deploys to `gastto-develop`.
  - Explanation that environment variables (sensitive and non-sensitive) live in Fly.io, not in GitHub, with the sole exception of the Fly.io API tokens needed by GitHub Actions.
- [x] Add a comment in `fly.toml` and `fly.develop.toml` noting that `auto_stop_machines` must be changed to `false` when BullMQ workers are introduced (per ADR-009).
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 7: ADR-010 - Multi-Environment Deployment on Fly.io

Write an Architecture Decision Record that captures the infrastructure decisions made in this task. These decisions affect the project's operational architecture, security posture, and cost model.

- [x] Read `docs/adr/template.md` and `docs/adr/adr.md` to understand the ADR format and existing decision style.
- [x] Write ADR-010 in `docs/adr/adr.md` covering:
  - Context: the need for isolated production and development environments as the team grows and features stabilize.
  - Decision: two separate Fly.io apps (`gastto` and `gastto-develop`) with branch-based auto-deployment via GitHub Actions.
  - Decision: all environment-specific configuration (including secrets) stored in Fly.io secrets per app, not in GitHub repository variables.
  - Decision: one Telegram bot per environment to avoid webhook collisions and isolate test traffic.
  - Decision: multi-stage Dockerfile to reduce image size and exclude dev dependencies.
  - Decision: unified port 3000 across Dockerfile, Fly.io configs, and application defaults.
  - Decision: 256mb RAM per VM to fit Fly.io free tier limits.
  - Decision: `auto_stop_machines = true` as a temporary safe setting until BullMQ workers are introduced (when it must flip to `false` per ADR-009).
  - Alternatives considered: single app with preview deployments, storing env vars in GitHub, sharing one Telegram bot, keeping port 8080.
  - Consequences: operational overhead of managing two sets of secrets, need for a second Telegram bot, doubled free-tier resource consumption, but gains full environment isolation and safe staging.
- [x] Update the "Resumen de Decisiones" table at the end of `docs/adr/adr.md` to include ADR-010.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

# Next step

All phases are complete. Consider committing the changes and exporting this conversation as a `.md` file alongside the plan.

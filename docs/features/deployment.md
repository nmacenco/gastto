# Deployment Operations Guide

This document describes the multi-environment Fly.io infrastructure, including
merge-protected deployment, persistent BullMQ worker Machines, graceful shutdown,
secrets management, and Telegram bot isolation.

## Apps

The project uses two separate Fly.io apps for full environment isolation:

| Environment | Fly.io App       | Branch    | Config File        |
| ----------- | ---------------- | --------- | ------------------ |
| Production  | `gastto`         | `main`    | `fly.toml`         |
| Development | `gastto-develop` | `develop` | `fly.develop.toml` |

### Creating the development app

If `gastto-develop` does not yet exist in your Fly.io organization, create it with:

```bash
flyctl apps create gastto-develop
```

The production app (`gastto`) is assumed to already exist.

## Secrets

All environment-specific configuration (sensitive and non-sensitive) lives in Fly.io secrets per app. The only values stored in GitHub are the Fly.io API tokens required by GitHub Actions to trigger deploys.

### Required secrets per environment

Set the following secrets on **each** app. Values should differ between production and development.

| Secret                    | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`            | PostgreSQL connection string                              |
| `REDIS_URL`               | Redis connection string (BullMQ / cache)                  |
| `TELEGRAM_BOT_TOKEN`      | Telegram Bot API token                                    |
| `TELEGRAM_WEBHOOK_SECRET` | Random string used to validate Telegram webhook origin    |
| `OPENAI_API_KEY`          | OpenAI API key for LLM extraction                         |
| `ANTHROPIC_API_KEY`       | Anthropic API key (optional)                              |
| `SENTRY_DSN`              | Sentry DSN for error tracking (optional)                  |
| `ENCRYPTION_KEY`          | AES-256-GCM key for OAuth token encryption (64 hex chars) |

### Setting secrets on production

```bash
flyctl secrets set --app gastto \
  DATABASE_URL="..." \
  REDIS_URL="..." \
  TELEGRAM_BOT_TOKEN="..." \
  TELEGRAM_WEBHOOK_SECRET="..." \
  OPENAI_API_KEY="..." \
  ANTHROPIC_API_KEY="..." \
  SENTRY_DSN="..." \
  ENCRYPTION_KEY="..."
```

### Setting secrets on development

```bash
flyctl secrets set --app gastto-develop \
  DATABASE_URL="..." \
  REDIS_URL="..." \
  TELEGRAM_BOT_TOKEN="..." \
  TELEGRAM_WEBHOOK_SECRET="..." \
  OPENAI_API_KEY="..." \
  ANTHROPIC_API_KEY="..." \
  SENTRY_DSN="..." \
  ENCRYPTION_KEY="..."
```

## Telegram Bot Isolation

To avoid webhook collisions and isolate test traffic, each environment must use its own Telegram bot.

1. Create a second bot via [@BotFather](https://t.me/BotFather) on Telegram.
2. Obtain the new bot token and set it as `TELEGRAM_BOT_TOKEN` on the `gastto-develop` app.
3. Register the webhook URL for the development app:

   ```bash
   curl -X POST "https://api.telegram.org/bot<DEVELOP_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://gastto-develop.fly.dev/webhook/telegram"}'
   ```

The production bot keeps its existing webhook pointing to `https://gastto.fly.dev`.

## GitHub Actions Secrets

The repository needs two secrets so the workflow in `.github/workflows/fly-deploy.yml` can authenticate with Fly.io:

| Secret                  | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `FLY_API_TOKEN`         | Deploys the `main` branch to the `gastto` app            |
| `FLY_API_TOKEN_DEVELOP` | Deploys the `develop` branch to the `gastto-develop` app |

Generate tokens via [Fly.io tokens dashboard](https://fly.io/user/personal_access_tokens) and add them under **Settings > Secrets and variables > Actions** in the GitHub repository.

## Branch-to-Environment Mapping

| Branch    | GitHub Workflow Trigger | Fly.io App       | Fly.io Config      |
| --------- | ----------------------- | ---------------- | ------------------ |
| `main`    | Push to `main`          | `gastto`         | `fly.toml`         |
| `develop` | Push to `develop`       | `gastto-develop` | `fly.develop.toml` |

Pushes to any other branch do not trigger automatic deploys.

The deployment workflow listens only for `push` events. Opening or updating a
pull request, including a `synchronize` event caused by pushing another commit to
the PR branch, does not deploy either environment. A push workflow cannot
distinguish a merge commit from a direct push, so the merge-only guarantee comes
from the repository protections described below, not from the workflow trigger
alone.

Each deploy command includes `--ha=false`. If an app ever has zero Machines, this
prevents the deployment from creating redundant Machines and preserves the
single-Machine capacity policy.

## Environment Variables Location

- **Fly.io secrets**: All runtime configuration (database URLs, API keys, bot tokens, encryption keys). These are encrypted at rest and injected as environment variables into the running containers.
- **GitHub repository secrets**: Only the two Fly.io API tokens (`FLY_API_TOKEN` and `FLY_API_TOKEN_DEVELOP`). No application secrets are stored in GitHub.
- **Fly.io config files (`fly.toml`, `fly.develop.toml`)**: Non-sensitive, static infrastructure settings (port, memory, region, `NODE_ENV`).

This separation ensures that rotating a third-party API key or database credential requires a single `flyctl secrets set` command, with no GitHub interaction needed.

## Continuous Integration

The project uses a GitHub Actions workflow (`.github/workflows/ci.yml`) to validate every change before it is merged.

### What runs

The `ci.yml` workflow runs the following quality gates on every pull request and on every push to `main` and `develop`:

| Step      | Command                          | What it checks                                 |
| --------- | -------------------------------- | ---------------------------------------------- |
| Install   | `pnpm install --frozen-lockfile` | Dependencies resolve cleanly with the lockfile |
| Lint      | `pnpm lint`                      | ESLint rules pass on all `src/**/*.ts` files   |
| Typecheck | `pnpm typecheck`                 | `tsc --noEmit` passes with strict mode         |
| Build     | `pnpm build`                     | `tsup` compiles successfully to `dist/main.js` |
| Test      | `pnpm test`                      | The complete Vitest suite passes               |

### When it runs

- **On pull requests**: Runs automatically when a PR is opened or updated. Checks appear at the bottom of the PR conversation.
- **On push to `main` or `develop`**: Runs after the merge is completed, validating the resulting state of the branch.

### Viewing results

Check results appear in the **Checks** tab of the pull request on GitHub. The job
identifier is `quality` and its displayed check name is `Quality gates`. If any
gate fails, the PR cannot be merged until branch protection rules are satisfied
(see next section).

## Branch Protection Setup

Branch protection rules or repository rulesets must ensure that no one,
including administrators and automation actors, can push directly to `main` or
`develop` or merge without passing the CI checks.

### Steps to configure

1. Go to the repository on GitHub: **Settings > Branches > Branch protection rules > Add rule**.
2. Enter the branch name pattern: `main` (create one rule per pattern).
3. Repeat for `develop` (or use a single pattern rule with `main,develop` if the GitHub UI supports it).
4. Enable the following options:
   - **"Require a pull request before merging"**
     - Prevents direct pushes to the branch.
     - Optional: enable **"Require approvals"** and set to 1 reviewer for extra safety.

   - **"Require status checks to pass before merging"**
     - Search for and select the `Quality gates` check (job identifier `quality`)
       from the `ci.yml` workflow.
     - This blocks the merge button in the PR UI until all gates are green.

   - **Apply protections to administrators**
     - Enable administrator enforcement for branch protection rules, or disable
       ruleset bypass for repository administrators.

   - **Disallow force pushes**
     - Do not enable any option that permits force pushes to either protected
       branch.

   - **No bypass actors**
     - Leave the ruleset bypass list empty. Do not grant users, teams, apps, or
       deploy keys permission to bypass the pull-request and `quality` rules.

5. Save the rule.

### What this prevents

With this configuration:

- A developer opens a PR and pushes broken code (e.g., a type error or a failing test).
- The CI workflow runs and fails on the `typecheck` or `test` gate.
- The PR merge button stays blocked until all checks pass.
- A direct push to `main` or `develop` is rejected before it can trigger a
  deployment.

This prevents incidents like the Fastify plugin version mismatch from reaching the deployable branches.

Protection is an external repository setting and must be inspected periodically
for both branches. Required state is: pull requests required, `Quality gates`
required, administrator enforcement enabled, force pushes disabled, and no bypass
actors. If any item cannot be verified, do not claim that deployment is
merge-only.

## Persistent Worker Lifecycle

Fastify and BullMQ workers run in one persistent process. Both Fly configurations
therefore use the same lifecycle settings:

```toml
kill_signal = "SIGTERM"
kill_timeout = "30s"

[http_service]
  auto_stop_machines = "off"
  auto_start_machines = false
```

`min_machines_running` is intentionally absent. Runtime capacity is managed as
exactly one Machine in the `app` process group for each environment. Automatic
start remains disabled because automatic stop is disabled; BullMQ work must not
depend on inbound HTTP traffic to wake the process.

During a deploy, host migration, or manual stop, Fly.io sends `SIGTERM`. The Node.js
entry point calls `app.close()` once, and the Fastify shutdown hook closes all
BullMQ Workers before their Queues. Fly.io allows up to 30 seconds for this drain.
Review the timeout if observed job durations routinely approach or exceed that
window.

Inspect capacity without changing it:

```bash
flyctl scale show --app gastto-develop
flyctl machine list --app gastto-develop
flyctl scale show --app gastto
flyctl machine list --app gastto
```

If the `app` process group count is not one, record the current Machine IDs,
regions, statuses, and target state. Scaling down destroys capacity and requires
explicit operator confirmation before running:

```bash
flyctl scale count app=1 --app <app-name>
```

Do not modify unrelated process groups. After an approved change, repeat both
inspection commands and confirm exactly one running `app` Machine remains in the
intended region.

## Rollout and Verification

Roll out development before production:

1. Merge a reviewed pull request into protected `develop` after `quality` passes.
2. Confirm the resulting push run targets `gastto-develop`, uses
   `fly.develop.toml`, and passes `--ha=false`.
3. Confirm one running `app` Machine, a healthy endpoint, worker-start logs, and
   continued operation after an idle interval long enough for Fly Proxy autostop
   evaluation.
4. Exercise a safe development queue operation and a controlled shutdown or
   redeploy. Confirm delayed work continues and the Fastify/BullMQ drain completes
   within 30 seconds.
5. Promote the same reviewed change to protected `main` only after development
   verification succeeds.
6. Confirm the production push run targets `gastto`, uses `fly.toml`, and passes
   `--ha=false`; then verify one running `app` Machine, health, worker-start logs,
   and absence of new shutdown, Redis, queue-stall, or repeated-job errors.

Do not expose secrets or mutate production data during verification. Record the
GitHub protection, Fly scale, health, and graceful-shutdown evidence in the pull
request or deployment record.

## Rollback

If rollout fails, revert the relevant merge commit with
`git revert -m 1 <merge-sha>` and deploy the restored version through the same
protected-branch workflow. Do not force-push, edit migration history, or re-enable
automatic stopping while BullMQ workers remain in the runtime. Keeping autostop
disabled preserves queue consumption while the application rollback is reviewed.

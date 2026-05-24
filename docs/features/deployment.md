# Deployment Operations Guide

This document describes the complete manual setup required for the multi-environment Fly.io infrastructure, including secrets management and Telegram bot isolation.

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

## Environment Variables Location

- **Fly.io secrets**: All runtime configuration (database URLs, API keys, bot tokens, encryption keys). These are encrypted at rest and injected as environment variables into the running containers.
- **GitHub repository secrets**: Only the two Fly.io API tokens (`FLY_API_TOKEN` and `FLY_API_TOKEN_DEVELOP`). No application secrets are stored in GitHub.
- **Fly.io config files (`fly.toml`, `fly.develop.toml`)**: Non-sensitive, static infrastructure settings (port, memory, region, `NODE_ENV`).

This separation ensures that rotating a third-party API key or database credential requires a single `flyctl secrets set` command, with no GitHub interaction needed.

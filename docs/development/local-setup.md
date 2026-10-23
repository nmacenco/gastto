---
title: 'Local Development Setup'
last_updated: '2026-08-23'
source_of_truth: ['.env.example', 'docker-compose.yml', 'src/main.ts']
tags: ['development', 'local', 'setup', 'docker']
---

# Local Development Setup

This guide walks you through running Gastto locally for development. It covers Redis (via Docker), Telegram webhooks, Google OAuth, and all required environment variables.

> **Prerequisites:** Node.js >= 20.0.0, pnpm (bundled via `corepack` or installed globally), and Docker + Docker Compose (for Redis only).

> **Database:** The project connects directly to the **Supabase development project** for PostgreSQL. There is no local PostgreSQL container.

---

## 1. Quick Start

```bash
# 1. Clone the repo (if you haven't already)
cd gastto

# 2. Install dependencies
pnpm install

# 3. Start Redis (the only local infrastructure needed)
docker-compose up -d

# 4. Copy environment template
cp .env.example .env
# Edit .env with your values (see section 3 below)

# 5. Apply database migrations to Supabase
pnpm db:migrate

# 6. Start the dev server
pnpm dev
```

The server will be available at `http://localhost:3000`.

---

## 2. Infrastructure

### Redis (Docker — Required)

Redis runs locally via Docker Compose. It is used exclusively as the BullMQ broker and identity cache.

```bash
# Start Redis
docker-compose up -d

# Stop Redis
docker-compose down

# Stop and wipe Redis data
docker-compose down -v
```

| Service | Host        | Port   | Volume       |
| ------- | ----------- | ------ | ------------ |
| Redis   | `localhost` | `6379` | `redis_data` |

**Why local Redis instead of a managed development broker?**

Local Docker Redis keeps tests, restarts, and experimental queue data isolated
from the deployed development environment. `gastto-develop` uses Aiven for Valkey
under ADR-021, but its credentials and BullMQ state must not be reused locally.

### PostgreSQL (Supabase)

The application connects directly to the **Supabase development project**. There is no local PostgreSQL container.

```bash
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres
```

**Caveats:**

- You share the database with other developers and the deployed `gastto-develop` app.
- Running `pnpm db:migrate` affects everyone. Coordinate schema changes.
- Good for testing against real data, but risky for experimental migrations.

---

## 3. Environment Variables

Copy `.env.example` to `.env` and fill every required field.

### 3.1 Runtime

```bash
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
```

### 3.2 Database (Supabase)

```bash
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres
```

### 3.3 Redis

**Docker:**

```bash
REDIS_URL=redis://localhost:6379
```

**Note:** Redis does not require TLS locally, so plain `redis://` is correct here.
Hosted Redis-compatible providers require `rediss://`. The shared runtime uses
`maxRetriesPerRequest: null` so BullMQ controls retry behavior across providers.

### 3.4 LLM

At least one LLM provider is required for NLP expense extraction.

```bash
# OpenAI (optional)
OPENAI_API_KEY=sk-...

# Anthropic (optional)
ANTHROPIC_API_KEY=sk-ant-...

# NVIDIA (optional)
NVIDIA_API_KEY=nvapi-...
```

### 3.5 Telegram Bot

#### Step 1: Create a Bot

1. Open Telegram and search for **@BotFather**.
2. Send `/newbot` and follow the prompts.
3. Copy the **Bot Token** (e.g., `123456789:ABCdefGHIjklMNOpqrSTUvwxyz`).
4. Generate a random webhook secret:
   ```bash
   openssl rand -hex 32
   ```

#### Step 2: Webhook URL

Telegram requires a **public HTTPS URL** to deliver webhooks. For local development, use **ngrok**:

```bash
# Install ngrok if you haven't: https://ngrok.com/download
ngrok http 3000
```

ngrok will output a URL like `https://abcd-123-456-789.ngrok.io`. Set:

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxyz
TELEGRAM_WEBHOOK_SECRET=your_random_secret_here
WEBHOOK_BASE_URL=https://abcd-123-456-789.ngrok.io
```

> **Why ngrok?** Telegram servers cannot reach `http://localhost:3000`. The app auto-detects localhost and skips webhook registration, so you will never receive messages. ngrok creates a public tunnel to your local machine.

> **Important:** The free ngrok URL changes every time you restart ngrok. You must update `WEBHOOK_BASE_URL` and restart the app each time. For a stable URL, upgrade ngrok or use a cloud tunnel alternative.

### 3.6 Google OAuth

Required for the Google Drive / Sheets onboarding flow.

#### Step 1: Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or use an existing one).
3. Navigate to **APIs & Services > Library**.
4. Enable **Google Sheets API** and **Google Drive API**.
5. Navigate to **APIs & Services > OAuth consent screen**.
   - Choose **External** (or Internal if you have a Workspace).
   - Fill in app name, user support email, and developer contact.
   - Add scope: `https://www.googleapis.com/auth/drive.file`.
   - Add your Gmail as a test user.
6. Navigate to **APIs & Services > Credentials**.
   - Click **Create Credentials > OAuth client ID**.
   - Application type: **Web application**.
   - Name: `Gastto Local`.
   - Authorized redirect URIs: `http://localhost:3000/auth/google/callback`.
   - Click **Create** and copy the **Client ID** and **Client Secret**.

```bash
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

> **Note:** The `GOOGLE_REDIRECT_URI` must match **exactly** what you registered in Google Cloud Console, including `http` vs `https`, port, and trailing slash.

### 3.7 Security

The app encrypts OAuth tokens at rest using AES-256-GCM (ADR-007). Generate a key:

```bash
openssl rand -hex 32
```

```bash
ENCRYPTION_KEY=abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
```

> **Warning:** Never commit this key. It is server-side only. If you lose it, all stored OAuth tokens become unreadable.

### 3.8 Observability (Optional)

```bash
# Optional: Sentry error tracking
SENTRY_DSN=
```

---

## 4. Full .env Example

```bash
# Runtime
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database — Supabase
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres

# Redis — Docker
REDIS_URL=redis://localhost:6379

# LLM
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=

# Telegram
TELEGRAM_WEBHOOK_SECRET=your_random_secret
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
WEBHOOK_BASE_URL=https://abcd-123.ngrok.io

# Observability
SENTRY_DSN=

# OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Security
ENCRYPTION_KEY=...
```

---

## 5. Database Migrations

Drizzle ORM manages schema migrations. The migration files live under `drizzle/` and are immutable once applied.

```bash
# Generate a new migration from schema changes
pnpm db:generate

# Apply pending migrations to Supabase
pnpm db:migrate

# Open Drizzle Studio (GUI to browse tables)
pnpm db:studio
```

> **Rule:** Never hand-edit files under `drizzle/`. To revert a migration, create a new migration that undoes the change.

> **Warning:** `pnpm db:migrate` affects the shared Supabase development database. Coordinate with other developers before running migrations.

---

## 6. Running the Application

### Development Mode (Hot Reload)

```bash
pnpm dev
```

- Fastify server starts on `http://localhost:3000`.
- BullMQ workers start in the same process.
- TypeScript recompiles on file changes via `tsx watch`.

### Health Check

```bash
curl http://localhost:3000/health
# Expected: {"status":"ok","ts":"2026-06-10T..."}
```

### Swagger / OpenAPI Docs

Visit `http://localhost:3000/documentation` when the server is running.

---

## 7. Testing

```bash
# Run tests once
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

Tests use Vitest + Testcontainers to spin up real PostgreSQL and Redis containers. No need to have Docker services running beforehand.

---

## 8. Troubleshooting

### "Redis connection error" on startup

- Is Redis running? `docker ps` should show `gastto-redis` as `Up`.
- Did you set `REDIS_URL=redis://localhost:6379`? Do not use `rediss://` locally.

### "Invalid environment variables"

- Check that all `required` variables in `.env` are filled. `src/config/env.schema.ts` defines the schema.
- The app crashes early with a JSON list of missing fields.

### Telegram messages not arriving

- Did you start ngrok? `WEBHOOK_BASE_URL` must be a public HTTPS URL, not `localhost`.
- Did you restart the app after changing `WEBHOOK_BASE_URL`? The app registers the webhook on startup.
- Check Telegram Bot API status: send a message to your bot and check app logs.

### Google OAuth callback fails with "redirect_uri_mismatch"

- The `GOOGLE_REDIRECT_URI` in your `.env` must match **exactly** the URI in Google Cloud Console > Credentials.
- Common mistakes: `http` vs `https`, missing port, extra trailing slash.

### "Failed to initialize infrastructure" in logs

- Usually means `DATABASE_URL` or `REDIS_URL` is missing or invalid.
- The app catches this and starts the HTTP server without workers, so health check still responds.

### Managed broker quota or capacity warning

- Confirm local development is not using a hosted `REDIS_URL`.
- Switch local work to Docker Redis: `REDIS_URL=redis://localhost:6379`.
- Run `docker-compose up -d`.
- Do not copy Aiven or production credentials into `.env`.
- See [ADR-021](../adr/ADR-021-use-aiven-valkey-for-development-bullmq.md)
  and the [Deployment Operations Guide](../features/deployment.md) for deployed
  capacity thresholds and provider rotation.

---

## 9. Checklist Before First Run

- [ ] `pnpm install` completed without errors.
- [ ] `.env` created from `.env.example` and all fields filled.
- [ ] Redis is running (Docker required).
- [ ] Supabase `DATABASE_URL` is configured in `.env`.
- [ ] Migrations applied (`pnpm db:migrate`).
- [ ] Telegram bot created via @BotFather.
- [ ] ngrok running with a public HTTPS URL.
- [ ] Google Cloud Console project created with OAuth credentials.
- [ ] `ENCRYPTION_KEY` generated (`openssl rand -hex 32`).
- [ ] `pnpm dev` starts without errors.
- [ ] `curl http://localhost:3000/health` returns `{"status":"ok"}`.

---

## Related Documents

- [`docs/architecture/config-env.md`](./config-env.md) — Full environment variable reference.
- [`docs/architecture/data-model.md`](./data-model.md) — Database schema and relationships.
- [`docs/adr/adr.md`](../adr/adr.md) — Architecture Decision Records (ADR-005, ADR-009, ADR-010).

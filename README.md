# Gastto

Asistente financiero conversacional — WhatsApp & Telegram → Google Sheets / Excel Online

## Quick Start (Local Development)

```bash
# 1. Install dependencies
pnpm install

# 2. Start Redis (only local infrastructure needed)
docker-compose up -d

# 3. Configure environment
cp .env.example .env
# Edit .env with your Supabase, Redis, Telegram, and Google OAuth credentials

# 4. Apply database migrations
pnpm db:migrate

# 5. Run the development server
pnpm dev
```

The server will be available at `http://localhost:3000`.

### Test Telegram locally

A public HTTPS tunnel is required for Telegram webhook testing because Telegram
cannot send updates directly to `localhost`. It is not required for automated
tests, Swagger, or the health endpoint.

Start ngrok in a separate terminal:

```bash
ngrok http 3000
```

Copy the generated HTTPS URL into `.env`:

```env
WEBHOOK_BASE_URL=https://your-address.ngrok-free.app
```

Then restart `pnpm dev`. On startup, the app automatically registers the Telegram
webhook at `<WEBHOOK_BASE_URL>/webhook/telegram`. Free ngrok URLs may change when
ngrok restarts, so update `WEBHOOK_BASE_URL` and restart the app whenever the URL
changes.

## Documentation

- **[Local Development Setup](docs/development/local-setup.md)** — Complete step-by-step guide for running the project locally.
- **[Architecture Decision Records (ADR)](docs/adr/adr.md)** — Design decisions and technical rationale.
- **[Configuration & Environment](docs/architecture/config-env.md)** — Environment variables reference.
- **[Data Model](docs/architecture/data-model.md)** — Database schema and relationships.
- **[Testing Guidelines](docs/testing/guidelines.md)** — Testing rules and coverage targets.

## Tech Stack

- **Runtime:** Node.js 20 + Fastify
- **Language:** TypeScript
- **Architecture:** Clean Architecture (Domain → Application → Infrastructure → Interfaces)
- **Queue:** BullMQ + Redis
- **Database:** PostgreSQL (via Supabase) + Drizzle ORM
- **NLP:** OpenAI / Claude
- **Spreadsheets:** Google Sheets API
- **Deployment:** Fly.io (optional, not required for local development)

## NPM Scripts

| Script            | Description                              |
| ----------------- | ---------------------------------------- |
| `pnpm dev`        | Start development server with hot reload |
| `pnpm build`      | Build for production                     |
| `pnpm test`       | Run tests (Vitest)                       |
| `pnpm lint`       | Lint source files                        |
| `pnpm db:migrate` | Apply database migrations                |
| `pnpm db:studio`  | Open Drizzle Studio                      |
| `pnpm redis:up`   | Start local Redis (Docker)               |
| `pnpm redis:down` | Stop local Redis                         |

## License

UNLICENSED

# Gastto

Asistente financiero conversacional — WhatsApp & Telegram → Google Sheets / Excel Online

## Quick Start (Local Development)

```bash
cp .env.example .env
# Fill the local database password, dedicated Telegram bot, ngrok,
# Google OAuth, encryption, and an LLM provider in the ignored .env.
docker compose -f compose.local.yml up --build
```

Compose starts PostgreSQL, Redis, migrations, ngrok, and the app. The server is at
`http://localhost:3000`. See the [local setup guide](docs/development/local-setup.md)
for Google OAuth callbacks, checks, and the core-only option. No hosted database
or host-side Node installation is needed for the Compose stack.

## Documentation

- **[Local Development Setup](docs/development/local-setup.md)** — Complete step-by-step guide for running the project locally.
- **[Architecture Decision Records (ADR)](docs/adr/adr.md)** — Design decisions and technical rationale.
- **[Configuration & Environment](docs/architecture/config-env.md)** — Environment variables reference.
- **[Data Model](docs/architecture/data-model.md)** — Database schema and relationships.
- **[Testing Guidelines](docs/testing/guidelines.md)** — Testing rules and coverage targets.

## Tech Stack

- **Runtime:** Node.js 24 + Fastify
- **Language:** TypeScript
- **Architecture:** Clean Architecture (Domain → Application → Infrastructure → Interfaces)
- **Queue:** BullMQ + Redis
- **Database:** PostgreSQL + Drizzle ORM (local Compose; hosted provider for deployment)
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

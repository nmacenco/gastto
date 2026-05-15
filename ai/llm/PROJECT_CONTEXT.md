# PROJECT CONTEXT (LLM-optimized)

Gastto — conversational financial assistant. Users send expenses via WhatsApp/Telegram in natural language; the bot parses them with LLMs and writes to Google Sheets or Excel Online.

## Architecture

- **Runtime:** Node.js ≥20, TypeScript 5.5+
- **Framework:** Fastify 4 (HTTP server + webhook routes)
- **Database:** PostgreSQL via `postgres` driver, Drizzle ORM for schema/migrations
- **Queue/Cache:** Redis (ioredis) + BullMQ for background jobs
- **Validation:** Zod for all inputs
- **LLMs:** OpenAI + Anthropic for natural language understanding
- **Spreadsheets:** Google Sheets API (`googleapis`) + Microsoft Graph (`@microsoft/microsoft-graph-client`)
- **Messaging:** Custom WhatsApp & Telegram adapters under `infrastructure/adapters/`
- **Logging:** Pino + pino-pretty
- **Error Tracking:** Sentry (`@sentry/node`)
- **Security:** `@fastify/helmet`, `@fastify/sensible`

## Modules

| Path                                  | Purpose                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `src/application/dtos/`               | Data transfer objects                                              |
| `src/application/services/`           | Domain services                                                    |
| `src/application/use-cases/`          | Business use-cases (conversation, expense, spreadsheet, user)      |
| `src/config/`                         | App configuration and env loading                                  |
| `src/domain/entities/`                | Core domain entities                                               |
| `src/domain/ports/`                   | Repository/service interfaces (driven/driving)                     |
| `src/domain/value-objects/`           | Immutable value objects                                            |
| `src/infrastructure/adapters/`        | External service adapters (excel, llm, sheets, telegram, whatsapp) |
| `src/infrastructure/db/repositories/` | Drizzle repository implementations                                 |
| `src/infrastructure/db/schema/`       | Drizzle table schemas                                              |
| `src/infrastructure/redis/`           | Redis connection and helpers                                       |
| `src/interfaces/http/routes/`         | Fastify route definitions                                          |
| `src/interfaces/workers/`             | BullMQ background job workers                                      |

## Key Contracts

- **Naming:** camelCase files/variables, PascalCase classes/types
- **Validation:** Zod schemas for all external inputs and DTOs
- **Use-case pattern:** each use-case is an independent function/class in `src/application/use-cases/<domain>/`
- **Repository pattern:** interfaces in `src/domain/ports/`, implementations in `src/infrastructure/db/repositories/`
- **Adapters:** each external service has its own folder under `src/infrastructure/adapters/`
- **Verification (mandatory after changes):**
  ```bash
  pnpm typecheck
  pnpm lint
  pnpm test
  ```

## Entities

- **User** — person interacting via WhatsApp/Telegram, linked to a spreadsheet
- **Expense** — financial transaction with amount, currency, category, date, description
- **Conversation** — message thread and contextual state per user
- **Spreadsheet** — linked Google Sheet or Excel workbook with sheet/tab selection
- **ColumnMapping** — mapping between expense fields and spreadsheet columns

## Deep Docs

| Topic                     | Path                     |
| ------------------------- | ------------------------ |
| Agent workflow & commands | `AGENTS.md`              |
| Architecture details      | `docs/architecture/*.md` |
| Feature specs             | `docs/features/*.md`     |
| Epics & user stories      | `docs/user-stories/`     |
| ADRs                      | `docs/adr/*.md`          |
| Plans & conventions       | `docs/plans/*.md`        |
| Reusable agent skills     | `.agents/skills/`        |

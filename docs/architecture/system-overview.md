# System Overview — Gastto

Gastto is a conversational expense tracker with no frontend. Users message via WhatsApp or Telegram; the bot parses expenses with an LLM and writes them to the user's own Google Sheet or Excel Online.

## What does NOT exist

- No web frontend (no React, no Next.js, no HTML)
- No Supabase Auth, no `@supabase/ssr`, no Supabase client SDK
- No serverless functions, no Vercel, no edge runtime
- No user-facing REST API (all interaction via messaging channels)
- No state stored exclusively in Redis (Redis is cache + queue broker only)

## Stack

| Layer            | Technology                                  |
| ---------------- | ------------------------------------------- |
| Runtime          | Node.js >= 20, TypeScript                   |
| HTTP framework   | Fastify                                     |
| Build            | tsup (CJS); dev: tsx --watch                |
| Architecture     | Clean Architecture + Modular Monolith       |
| Primary database | PostgreSQL on Supabase (driver: `postgres`) |
| ORM              | Drizzle ORM + Drizzle Kit                   |
| Queue            | BullMQ (broker: Upstash Redis)              |
| Cache / broker   | Upstash Redis (ioredis)                     |
| LLM              | Anthropic Claude via `LLMPort`              |
| Validation       | Zod                                         |
| Logging          | Pino (JSON structured)                      |
| Error monitoring | Sentry                                      |
| Testing          | Vitest + @vitest/coverage-v8                |
| Deploy           | Fly.io (single VM, persistent process)      |

## Runtime topology

A single Node.js process on Fly.io runs two concurrent responsibilities:

| Stage             | Technology                   | SLA                      |
| ----------------- | ---------------------------- | ------------------------ |
| Webhook receiver  | Fastify HTTP server          | Acknowledge < 300ms      |
| Message processor | BullMQ worker (same process) | Full NLP processing < 5s |

Fastify validates origin, enqueues a BullMQ job, sends an acknowledgement to the user, and returns HTTP 200. The worker runs the FSM, calls the LLM, writes to the spreadsheet, and sends the final response. These stages never share work synchronously.

## Modules

| Module                       | Responsibility                                                             |
| ---------------------------- | -------------------------------------------------------------------------- |
| **Messaging Gateway**        | Receive webhooks, validate origin, enqueue jobs, send responses            |
| **FSM Orchestrator**         | Determine current conversation state per user, route to correct handler    |
| **NLP Engine**               | Call LLM via `LLMPort`, extract structured expense entities from free text |
| **Spreadsheet Service**      | Read/write Google Sheets and Excel Online via `SpreadsheetPort` adapters   |
| **Conversation State Store** | Persist and transition FSM state in PostgreSQL                             |

Module boundaries follow Clean Architecture layers. Domain does not import from Infrastructure. Application does not import from Interfaces.

## Message lifecycle (happy path)

```
User message (WhatsApp / Telegram)
  → POST /webhook/:channel
  → Validate origin (HMAC / token header)
  → Enqueue job in BullMQ
  → Send acknowledgement ("Recibido…")
  → HTTP 200 to channel  [< 300ms]

BullMQ worker picks up job:
  → Resolve userId from (channel, externalId) via Redis cache or DB lookup
  → Load FSM state from PostgreSQL
  → Call LLM (NLP Engine) → extract entities
  → Transition FSM state
  → Write to spreadsheet if applicable
  → Send final response to user
  → Persist new FSM state  [< 5s total]
```

## User identity

- Internal `user_id` (UUID). Messaging identifiers (`chat_id`, phone number) live in `messaging_identities`.
- Resolution `(channel, externalId) → userId` is cached in Redis (TTL 24h).
- Multi-channel linking is out of scope for MVP; each `(channel, externalId)` creates an independent user record.

## Conversation state

- FSM with 14 states persisted in PostgreSQL (`conversation_states` table).
- Redis is never the source of truth for conversation state.
- Timeouts are implemented as delayed BullMQ jobs, not cron.
- States: `IDLE`, `ONBOARDING_START`, `ONBOARDING_DRIVE`, `ONBOARDING_FILE`, `ONBOARDING_SHEET`, `ONBOARDING_VALIDATING_ACCESS`, `ONBOARDING_MAPPING`, `ONBOARDING_CATEGORIES`, `EXPENSE_RECEIVING`, `EXPENSE_CLARIFYING`, `EXPENSE_REVIEW`, `EXPENSE_CORRECTING`, `EXPENSE_SAVING`, `EXPENSE_SAVING_RETRY`.
- Full transition table: `docs/architecture/fsm-states.md`.

## OAuth and spreadsheet access

- Users authorize Gastto via OAuth 2.0 (Google Drive / OneDrive).
- Tokens are stored AES-256 encrypted in PostgreSQL. Never plaintext, never logged, never exposed in API responses.
- Token refresh is transparent to the user.

## Supported channels (MVP)

- Telegram Bot API
- WhatsApp Business API

No other channels exist or are planned for Release 1.

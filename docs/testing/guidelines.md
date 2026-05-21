# Gastto — Testing Guidelines

**Stack:** Vitest · TypeScript · Fastify · BullMQ · Drizzle ORM · PostgreSQL · Redis · Testcontainers

## Rules

1. **Placement:** Unit tests live beside source (`*.spec.ts`). Integration tests in `src/__tests__/integration/`. E2E in `src/__tests__/e2e/`.
2. **No real external APIs in any test.** Mock Telegram, WhatsApp, Google Sheets, Excel Online, Anthropic.
3. **Respect Clean Architecture in tests.** Domain tests import nothing from Infrastructure. Application tests inject ports as mocks. Only integration tests wire real adapters to real DBs.
4. **Every FSM state transition must have a test.** See checklist below.
5. **Mandatory negative assertions** — never skip these:
   - If `appendRow()` or `save()` fails, NO confirmation message is sent.
   - If `appendRow()` fails, NO `expense_record` row is persisted.
   - Cancellation must set `state_payload = null` and state to `IDLE`.
   - Queue overflow must reject and must NOT modify the active user's current state.
6. **Coverage minimums:** Domain 90% (FSM 100%), Application 85% (Save/Cancel/Undo 100%), Adapters 75% (error classification 90%), Interfaces 70% (webhook origin 100%).

## Unit Tests

### Domain

- Pure TypeScript, zero mocks.
- Test construction, validation rules, value object equality.
- Test every FSM transition: given `(state, event)` assert `nextState`. Invalid transitions must throw.

### Application (Use Cases)

- Mock all ports with typed `vi.fn()` implementations.
- Test happy path + error paths (ports reject → typed domain error, never raw `Error`).
- Verify call order where it matters (e.g. `appendRow()` before `persistExpenseRecord()`).
- Verify NO messaging call when a dependency fails.

### Infrastructure Adapters

- Mock the HTTP client / SDK, never the adapter itself.
- Map HTTP errors to typed domain errors: `401` → `AUTH_ERROR`, timeout → `NETWORK_ERROR`, missing sheet → `STRUCTURE_ERROR`.
- Test AES-256 encrypt/decrypt round-trip.

### NLP / LLM Adapter

- Mock Anthropic SDK response.
- Verify valid JSON parses to correct `ExtractedExpense`.
- Verify malformed JSON throws `LLMParseError`, not raw `JSON.parse` error.
- Preserve `confianza_categoria: 'baja'` when returned.
- Return `null` for absent fields; never invent values.

### Amount Parsing (>=90% coverage)

| Input                             | `monto`   | `moneda`     |
| --------------------------------- | --------- | ------------ |
| `Pagué 45,50 EUR`                 | `45.50`   | `EUR`        |
| `Gasté $1.200 en taxi`            | `1200`    | `null`       |
| `Cargué nafta por 8.500,00 pesos` | `8500.00` | user default |
| `Pagué 30 por el café`            | `30`      | `null`       |
| `Fui al supermercado`             | `null`    | `null`       |
| `Gasté 0 pesos`                   | `0`       | user default |
| `15 lucas`                        | `15`      | user default |

## Integration Tests (Testcontainers: PostgreSQL + Redis)

### Setup

- Spin up real PG + Redis containers in `beforeAll`. Run migrations. Stop in `afterAll`.
- Never mock the DB layer.

### Required Scenarios

- **ConversationState:** upsert and retrieve by userId. State survives a 31-minute gap.
- **ExpenseQueue:** max 2 items per user; 3rd enqueue throws. FIFO order respected.
- **Soft Delete:** `getLatest` excludes soft-deleted rows; audit query includes them.
- **OAuth Token Encryption:** round-trip decrypt works. Plain text must NEVER appear in raw DB query results.

## E2E / Webhook Tests

- Start Fastify in-process. DB is real containerized PG. Messaging APIs mocked.
- **Origin validation:** valid secret → 200; invalid → 403 and zero enqueued jobs.
- **Malformed payload:** must return 200 (prevents Telegram retry loops).
- **Idempotency:** duplicate identical webhook processes only one expense record.
- **Timing:** receipt acknowledgement sent BEFORE NLP processing completes.

## FSM Transition Coverage Checklist

Test every row:

| Current State          | Event                  | Next State             |
| ---------------------- | ---------------------- | ---------------------- |
| `IDLE`                 | `expense_message`      | `EXPENSE_RECEIVING`    |
| `IDLE`                 | `unknown_user`         | `ONBOARDING_START`     |
| `EXPENSE_RECEIVING`    | `nlp_complete_partial` | `EXPENSE_CLARIFYING`   |
| `EXPENSE_RECEIVING`    | `nlp_complete_full`    | `EXPENSE_REVIEW`       |
| `EXPENSE_CLARIFYING`   | `user_reply`           | `EXPENSE_REVIEW`       |
| `EXPENSE_CLARIFYING`   | `cancel`               | `IDLE`                 |
| `EXPENSE_REVIEW`       | `confirm`              | `EXPENSE_SAVING`       |
| `EXPENSE_REVIEW`       | `correction`           | `EXPENSE_CORRECTING`   |
| `EXPENSE_REVIEW`       | `cancel`               | `IDLE`                 |
| `EXPENSE_REVIEW`       | `timeout_10min`        | `IDLE`                 |
| `EXPENSE_CORRECTING`   | `correction_applied`   | `EXPENSE_REVIEW`       |
| `EXPENSE_SAVING`       | `save_success`         | `IDLE`                 |
| `EXPENSE_SAVING`       | `network_error`        | `EXPENSE_SAVING_RETRY` |
| `EXPENSE_SAVING`       | `auth_error`           | `IDLE`                 |
| `EXPENSE_SAVING`       | `structure_error`      | `IDLE`                 |
| `EXPENSE_SAVING_RETRY` | `save_success`         | `IDLE`                 |
| `EXPENSE_SAVING_RETRY` | `ttl_expired`          | `IDLE`                 |
| `ONBOARDING_*`         | `cancel`               | `IDLE`                 |

## Do NOT Test

- Drizzle schema inference
- Fastify built-in JSON schema validation
- BullMQ's retry logic
- `postgres` driver connectivity
- Anthropic SDK HTTP transport
- Pino log formatting

## Factories

- Use shared factories in `src/__tests__/factories/index.ts`. Never inline mocks.
- Provide: `buildUser`, `buildValidExpense`, `buildTelegramTextPayload`, `buildExtractedExpense`.

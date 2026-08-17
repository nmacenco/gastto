# Harden OWASP Findings

## Goal

Resolve the seven concrete OWASP findings identified in the targeted security review while preserving the current Fastify, BullMQ, spreadsheet, and LLM architecture. The work will enforce a private-chat-only Telegram boundary, validate asynchronous inputs, neutralize injection paths, and prevent sensitive financial data from reaching logs or Sentry.

## Context

- [AGENTS.md](../../../AGENTS.md): Repository security, documentation, testing, logging, and ship-gate requirements.
- [Plan conventions](../../../docs/plans/plan-conventions.md): Required plan structure and execution rules.
- [ADR index](../../../docs/adr/adr.md), [ADR-005](../../../docs/adr/ADR-005-bullmq-redis.md), [ADR-008](../../../docs/adr/ADR-008-user-identity.md), [ADR-009](../../../docs/adr/ADR-009-fastify-persistent.md), and [ADR-011](../../../docs/adr/ADR-011-two-stage-pipeline.md): Webhook authentication, identity resolution, and the two-stage BullMQ pipeline.
- [ADR-002](../../../docs/adr/ADR-002-llm-extraction.md) and [ADR-004](../../../docs/adr/ADR-004-spreadsheet-adapter.md): Structured LLM extraction and spreadsheet adapter boundaries.
- [Structured logging ADR](../../../docs/adr/2026-06-10-structured-logging.md) and [observability architecture](../../../docs/architecture/observability.md): Pino and Sentry conventions.
- [Async pipeline architecture](../../../docs/architecture/async-pipeline.md), [configuration architecture](../../../docs/architecture/config-env.md), and [module contracts](../../../docs/architecture/module-contracts.md): Runtime composition and cross-layer contracts.
- [Incoming message routing](../../../docs/features/incoming-message-routing.md), [expense confirmation](../../../docs/features/expense-confirmation.md), and [column mapping inference](../../../docs/features/infer-and-propose-column-mapping.md): Canonical behavior affected by the security changes.
- [Testing guidelines](../../../docs/testing/guidelines.md): Required interface, adapter, worker, and negative-path test coverage.
- [Telegram authentication middleware](../../../src/interfaces/http/middleware/telegramAuth.ts), [Telegram webhook route](../../../src/interfaces/http/routes/telegram.webhook.ts), [payload parser](../../../src/infrastructure/adapters/telegram/TelegramPayloadParser.ts), and [incoming router](../../../src/application/use-cases/conversation/RouteIncomingMessage.ts): Current webhook and identity flow.
- [Incoming job contract](../../../src/application/ports/IncomingMessageJob.ts), [process job contract](../../../src/application/ports/ProcessMessageJob.ts), and [workers](../../../src/interfaces/workers): BullMQ payload boundaries currently enforced only by TypeScript types.
- [Google Sheets adapter](../../../src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts) and [expense registration](../../../src/application/use-cases/expense/RegisterExpense.ts): `USER_ENTERED` spreadsheet writes containing user-controlled strings.
- [Claude adapter](../../../src/infrastructure/adapters/llm/ClaudeAdapter.ts), [OpenAI adapter](../../../src/infrastructure/adapters/llm/OpenAIAdapter.ts), [NVIDIA adapter](../../../src/infrastructure/adapters/llm/NvidiaAdapter.ts), [header detection](../../../src/infrastructure/adapters/sheets/LLMHeaderDetectionAdapter.ts), and [column inference](../../../src/infrastructure/adapters/sheets/LLMColumnInferenceAdapter.ts): Prompt construction and structured-response validation.
- [Logger factory](../../../src/infrastructure/logger.ts), [Fastify factory](../../../src/bootstrap/createFastify.ts), and [bootstrap](../../../src/main.ts): Pino and Sentry configuration points.

No database schema, migration, domain event, dependency, or user-facing copy change is planned. Existing `SpreadsheetPort` and `LLMPort` method signatures remain unchanged.

## Phases

### Phase 1: Authenticate Telegram before body parsing and enforce private chats

#### Description

Move Telegram origin authentication to the earliest Fastify lifecycle stage and make private Telegram chats the explicit security boundary. Authenticated non-private updates will be acknowledged without creating an identity, enqueuing a job, sending an acknowledgement message, or changing conversation state.

#### Public contracts

- `/webhook/telegram` rejects a missing or invalid secret during `onRequest`, before Fastify parses or validates the body.
- Authenticated `group`, `supergroup`, and `channel` updates return HTTP 200 with `{ ok: true }` and perform no downstream side effects.
- Private-chat identity continues to use `(channel, chatId)`, which is unique to the Telegram user in a private conversation.

#### To-do actions

- [x] Change `validateTelegramOrigin` to an `onRequest` hook contract and register it through the route's `onRequest` option.
- [x] Add a small parser or route-level guard that recognizes non-private message and callback-query chat types without treating the payload as trusted before origin validation.
- [x] Short-circuit authenticated non-private updates before payload normalization, identity resolution, acknowledgement, or queue insertion.
- [x] Keep malformed private-update handling compatible with Telegram retry prevention while removing the raw body from its error log in preparation for Phase 5.
- [x] Update `telegramAuth.spec.ts`, `telegram.webhook.spec.ts`, and `telegram.webhook.integration.spec.ts` with assertions that authentication runs before body validation and that non-private updates return 200 with zero side effects.
- [x] Add parser coverage for private, group, supergroup, channel, callback-query, and missing-chat-type inputs where the parser participates in the policy.
- [x] Add a security decision ADR for the private-chat-only boundary and update `docs/adr/README.md`.
- [x] Update `docs/features/incoming-message-routing.md` with the authentication lifecycle and private-chat behavior, then update `docs/features/README.md`.
- [x] Run the targeted webhook and Telegram parser Vitest suites.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Validate BullMQ payloads and verify messaging identity bindings

#### Description

Turn BullMQ payload types into runtime trust boundaries. Every worker will parse job data with a strict Zod schema before side effects, and jobs carrying both an internal `userId` and messaging identity will verify that the pair belongs to the same user.

#### Public contracts

- `IncomingMessageJobData`, `ProcessMessageJobData`, OAuth reminder data, and the session-timeout payload gain exported strict Zod schemas while preserving their serialized wire fields.
- Worker processors reject malformed or unknown payload fields before acquiring locks, reading user data, sending messages, or changing state.
- `process-message` and OAuth reminder workers reject a validly shaped job when `(channel, externalId)` does not resolve to its declared `userId`.
- Worker dependency contracts gain only the repository or identity resolver needed for the binding check.

#### To-do actions

- [ ] Define strict Zod schemas beside the application-level incoming and process job contracts and infer their TypeScript types from those schemas.
- [ ] Move the OAuth reminder job contract out of the interface implementation into an application port and add a strict schema; define an explicit empty schema for session-timeout jobs.
- [ ] Parse `job.data` at the start of every worker processor and raise a controlled invalid-payload error containing validation metadata but no raw job data.
- [ ] Verify `(channel, externalId) -> userId` before processing `process-message` and OAuth reminder jobs; reject missing or mismatched identities.
- [ ] Wire the required identity dependency through `buildDependencies`, `registerWorkers`, `MessageWorkerDeps`, and `OAuthReminderWorkerDeps` without changing queue names or retry policy.
- [ ] Ensure failed invalid jobs are logged only with job ID, queue, error code, and validation paths.
- [ ] Extend all worker unit suites with malformed type, unknown field, invalid enum, invalid timestamp, mismatched identity, and zero-side-effect assertions.
- [ ] Update `docs/architecture/async-pipeline.md` and `docs/features/incoming-message-routing.md` with the runtime validation and identity-binding guarantees; update `docs/features/README.md`.
- [ ] Run the targeted worker and bootstrap Vitest suites.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Neutralize spreadsheet formula injection

#### Description

Preserve Google Sheets `USER_ENTERED` behavior for legitimate dates and numbers while preventing user-controlled strings from being interpreted as formulas.

#### Public contracts

- `SpreadsheetPort.appendRow` keeps its existing signature and return type.
- Google Sheets writes prefix an apostrophe to textual cell values whose first meaningful character is `=`, `+`, `-`, or `@`; numeric values and safe strings remain unchanged.
- The protection covers leading control characters and whitespace that could hide a formula prefix.

#### To-do actions

- [ ] Add a focused, deterministic cell sanitizer at the Google Sheets adapter boundary so every caller receives the same protection.
- [ ] Sanitize string values immediately before serializing the append request body while preserving numbers, null values, ordinary text, and already-safe apostrophe-prefixed strings.
- [ ] Keep `valueInputOption=USER_ENTERED` and `insertDataOption=INSERT_ROWS` unchanged to avoid altering existing spreadsheet behavior.
- [ ] Add Google Sheets adapter tests for all dangerous prefixes, leading whitespace and control characters, safe text, negative numeric values, nulls, and the final serialized request body.
- [ ] Add an expense-registration integration assertion that raw expense text beginning with a formula marker reaches the adapter as data and is persisted to Sheets in escaped form.
- [ ] Update `docs/features/expense-confirmation.md` with the spreadsheet-cell safety rule and update `docs/features/README.md`.
- [ ] Run the targeted Google Sheets and expense-registration Vitest suites.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 4: Establish LLM prompt trust boundaries

#### Description

Keep provider and domain port signatures stable while ensuring that user messages, spreadsheet contents, categories, and prior extracted values are always represented as untrusted data rather than interpolated into trusted system instructions.

#### Public contracts

- `LLMPort.extractExpense`, `interpretCorrection`, and `generateResponse` signatures remain unchanged.
- Provider system prompts contain only trusted, static instructions and output constraints.
- User context, current expense data, and raw messages are serialized into explicitly marked untrusted-data blocks in user-role content.
- Generic `generateResponse` calls receive a static provider-level guard instructing the model to ignore instructions found inside marked untrusted-data blocks.

#### To-do actions

- [ ] Split extraction and correction prompt builders into static trusted system instructions and JSON-serialized user content for Claude, OpenAI, and NVIDIA.
- [ ] Wrap user messages, category vocabularies, default currency, and current extracted values in consistently named untrusted-data markers.
- [ ] Add a static guard to each provider's `generateResponse` implementation and update header-detection and column-inference prompt builders to mark spreadsheet rows, headers, and samples as untrusted data.
- [ ] Preserve the existing Zod response schemas and strengthen semantic checks where output values must reference supplied rows, columns, or allowed enums.
- [ ] Ensure malformed or adversarial model output follows the current controlled fallback behavior and is never written directly to logs.
- [ ] Extend all three provider adapter suites to assert role separation and prove that malicious category/current-summary strings never appear in the system role.
- [ ] Extend header-detection and column-inference suites with instruction-like spreadsheet cells and out-of-range structured responses.
- [ ] Update `docs/features/infer-and-propose-column-mapping.md` with the LLM trust-boundary behavior and update `docs/features/README.md`.
- [ ] Run the targeted LLM, header-detection, and column-inference Vitest suites.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 5: Redact application logs and scrub Sentry events

#### Description

Prevent financial messages, raw webhook bodies, job payloads, authorization material, OAuth state, and provider response bodies from leaving the application through Pino, Fastify logs, or Sentry.

#### Public contracts

- Failed-job logs expose operational identifiers and error codes only; they do not include `job.data`, `rawMessage`, `rawPayload`, tokens, OAuth state, or external-provider bodies.
- Root Pino and Fastify request logging use a shared sensitive-path redaction policy as a defense in depth.
- Sentry applies a deterministic `beforeSend` scrubber to request data, contexts, breadcrumbs, tags, extras, and exception metadata before transmission.

#### To-do actions

- [ ] Define a shared sensitive-field/path policy covering authorization headers, cookies, tokens, secrets, OAuth state, raw messages, raw payloads, job data, and provider error bodies.
- [ ] Apply compatible redaction options to both `createLogger` and the Fastify logger configuration.
- [ ] Replace raw job payload, malformed webhook body, and sensitive provider-body logging with structured metadata such as endpoint, queue, job ID, status, code, and pseudonymous user ID where needed.
- [ ] Add a pure recursive Sentry event scrubber with bounded traversal and cycle-safe behavior, and register it through `Sentry.init({ beforeSend })`.
- [ ] Ensure application errors continue to reach Sentry without stack traces being returned to HTTP clients.
- [ ] Update logger-call tests to assert that sensitive fields are absent and operational metadata remains present; do not test Pino formatting.
- [ ] Add unit tests for nested Sentry request, breadcrumb, context, extra, exception, array, and case-variant sensitive keys.
- [ ] Update `docs/architecture/observability.md` with the redaction and Sentry scrubbing contracts.
- [ ] Run all targeted observability, worker, webhook, and bootstrap Vitest suites, then run `pnpm test` as the final regression gate.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Review and commit Phase 1, then execute Phase 2 to validate BullMQ payloads and messaging identity bindings.

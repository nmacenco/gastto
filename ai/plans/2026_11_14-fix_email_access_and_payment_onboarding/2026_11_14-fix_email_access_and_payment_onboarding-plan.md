# Fix Email Access Registration and Payment Onboarding Confirmation

## Goal

Resolve the reported missing email access request and the payment-method review loop during onboarding. Verify persistence against the correct request and database before changing the access flow, then make the advertised `confirmar` command complete onboarding.

## Context

- This plan is based on `develop` and is split into two independently reviewable phases. The working branch is `fix/email-access-and-payment-onboarding`.
- [Project instructions](../../../AGENTS.md), [plan conventions](../../../docs/plans/plan-conventions.md), [ADR index](../../../docs/adr/adr.md), [FSM ADR](../../../docs/adr/ADR-003-fsm-postgresql.md), [user identity ADR](../../../docs/adr/ADR-008-user-identity.md), [two-queue ADR](../../../docs/adr/ADR-011-two-stage-pipeline.md), and [testing guidelines](../../../docs/testing/guidelines.md) govern implementation and verification.
- Email access behavior is specified in [Telegram access approval](../../../docs/features/telegram-access-approval.md) and its persistence model in [data model](../../../docs/architecture/data-model.md). The relevant code is [RequestAccess](../../../src/application/use-cases/user/RequestAccess.ts), [DrizzleAccessRequestRepository](../../../src/infrastructure/db/repositories/DrizzleAccessRequestRepository.ts), [access request schema](../../../src/infrastructure/db/schema/index.ts), and the [message worker](../../../src/interfaces/workers/message.worker.ts).
- The current access path awaits `RequestAccess.execute()` and the repository transaction before sending the pending reply. The email is stored in `access_requests.email`, linked to `users` through `user_id`; `users` has no email column. The operator Gmail notice contains the request ID and is sent after the transaction. The reported missing row is not yet reproduced against the deployment database. It may be a lookup against another table or environment, but that is only a hypothesis.
- Payment onboarding behavior is specified in [payment methods](../../../docs/features/payment-methods.md), [category confirmation](../../../docs/features/category-confirmation.md), and [conversation state management](../../../docs/features/conversation-state-management.md). The relevant code is [intent recognition](../../../src/application/utils/intents.ts), [message worker](../../../src/interfaces/workers/message.worker.ts), and [ConfirmCategories](../../../src/application/use-cases/spreadsheet/ConfirmCategories.ts). In `ONBOARDING_CATEGORIES`, `isConfirmIntent()` routes to `ConfirmCategories.execute()`; its recognized words omit the advertised `confirmar`, so that message reaches `replyPayment()` and repeats the payment prompt.
- No live database or deployment secrets were inspected during planning. Use request IDs and sanitized environment identity for diagnosis; do not read `.env` or log credentials. No schema migration is expected from the current evidence.

### Phase 1 evidence (2026-11-14)

The disposable PostgreSQL integration suite passed 3 tests: a submitted request ID resolves to a committed normalized email and Telegram identity, identical submissions reuse the row, different emails supersede it, and a missing owner creates no row. The message-worker suite passed 251 tests, including a persistence-failure check that sends neither pending copy nor operator notice. `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed; the full default suite reported 196 files passed, 10 skipped, 2702 tests passed, and 48 skipped. The operator lookup is documented in the feature guide. The reported deployment row remains unverified until its request UUID and database environment can be compared; no application persistence defect was reproduced locally.

### Phase 2 evidence (2026-11-14)

The onboarding confirmation is scoped to `ONBOARDING_CATEGORIES`; expense confirmation retains its previous exact-word contract. Focused intent, worker, and confirmation suites passed 355 tests. The disposable PostgreSQL onboarding commit suite passed 3 tests, including the retained-method catalog and replay rejection. Final `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed; the default suite reported 196 files passed, 10 skipped, 2716 tests passed, and 49 skipped. Prettier and `git diff --check` passed. No schema change or migration was needed.

## Phases

### Phase 1: Verify and resolve email access request persistence

**Description:** Reproduce the reported email turn and establish whether the request is absent from PostgreSQL, present in another table or environment, or not committed. Deliver a verified diagnosis and, if the persistence path is faulty, a tested fix without changing the approval workflow.

**Public contracts:** Preserve `RequestAccess.execute({ userId, rawEmail, kind })` returning `invalid` or `submitted` with `AccessRequestSubmission`. A `submitted` result with `created: true` must identify a committed `access_requests` row containing the normalized email, matching user, kind, and pending status. The Telegram pending copy must be sent only after successful persistence; the operator notice must refer to that same request ID. Repeated identical emails remain idempotent, and a different email supersedes the previous pending request.

- [ ] Reproduce a new Telegram email submission in a disposable database, then correlate the operator email's `Solicitud` ID with `access_requests.id`, `messaging_identities.user_id`, and the intended environment. Compare database name/host identity through safe deployment metadata without printing connection secrets. Ask the operator for a sanitized query result if the deployed database is not accessible locally. Local reproduction passed; deployed request correlation awaits its UUID and environment.
- [ ] Characterize both outcomes: a committed request returns a pending reply and operator notice; a repository failure produces neither success copy nor operator notice. Check whether the observed missing value came from querying `users`, a different database, a superseded request, or a genuinely missing row. Local outcomes passed; the reported deployment outcome awaits correlation.
- [ ] If a committed request is actually missing, fix the proven transaction, wiring, or read-path defect in the smallest affected layer. If the row exists, document the correct `access_requests` lookup and environment diagnosis instead of changing working persistence code. The lookup is documented; the branch depends on deployment evidence.
- [x] Add meaningful Vitest coverage for normalized email persistence, idempotent repeat, supersession, request ID correlation, and failure ordering. Use a real disposable PostgreSQL database for repository persistence assertions and mocked messaging/Gmail boundaries for worker assertions. Record any integration suite that cannot run.
- [x] Update [Telegram access approval](../../../docs/features/telegram-access-approval.md) and [feature index](../../../docs/features/README.md) if implemented behavior or operator lookup guidance changes. Update [data model](../../../docs/architecture/data-model.md) only if the schema or relationship actually changes; generate a new migration from schema if required, without editing an applied migration.
- [x] Run focused tests and `pnpm test`; record executed and skipped tests and the verified database diagnosis.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Continue directly with Phase 2 as the user explicitly requested; no review pause.

### Phase 2: Complete payment-method onboarding with `confirmar`

**Description:** Make the command shown in the payment review prompt invoke final confirmation and leave onboarding only after the atomic commit succeeds.

**Public contracts:** In `ONBOARDING_CATEGORIES`, exact normalized `confirmar` must follow the confirmation path for both category review and payment review. During payment review, `ConfirmCategories.execute(input): Promise<ConfirmCategoriesOutput>` must commit the reviewed categories and payment methods through the existing guarded onboarding commit, clear the conversation to `IDLE`, and send the completion copy only after commit. Edit commands such as `quitar Nombre` and `renombrar Nombre a Otro` must continue to update the draft; cancellation must continue to discard it. Existing confirmation aliases remain valid.

- [x] Update confirmation intent recognition for `confirmar` and inspect its other callers so the added command does not change expense, sheet, mapping, or semantic-routing behavior unexpectedly. Keep the command exact after the existing normalization; do not treat edit phrases as confirmation.
- [x] Add a worker regression test that reproduces `quitar efectivo`, `quitar tarjeta de débito`, `confirmar` from payment review. Assert that the last message calls final confirmation rather than `replyPayment()`, persists the edited catalog, sends completion, and leaves `ONBOARDING_CATEGORIES` for `IDLE`.
- [x] Test category-to-payment transition, repeated/stale final confirmation, cancellation, and commit failure. Assert no false completion or partial catalog activation when the guarded commit fails. Run the PostgreSQL onboarding integration suite against a disposable database when available.
- [x] Update [payment methods](../../../docs/features/payment-methods.md), [category confirmation](../../../docs/features/category-confirmation.md), [conversation state management](../../../docs/features/conversation-state-management.md), and the [feature index](../../../docs/features/README.md) to reflect any implemented behavior change and the accepted confirmation wording.
- [x] Run focused tests and `pnpm test`; record executed and skipped tests.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Continue without a phase review pause as the user explicitly requested.

## Next step

Correlate the reported request UUID with the `access_requests` row in the database used by the Telegram bot that received it, then fix any defect that this evidence establishes.

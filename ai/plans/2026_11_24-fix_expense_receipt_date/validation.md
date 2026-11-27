# Receipt date parsing and recovery acceptance

## Scope and evidence

Implemented on `feat/add-category-during-expense-correction`, 2026-11-25. Evidence comes from deterministic unit tests and the existing PostgreSQL/Redis expense-flow harness. The LLM, semantic proposals, OAuth, spreadsheet API, and messaging boundaries are local test doubles. Classification, state transitions, registration, confirmation, FIFO handling, and database repositories execute their actual implementations. Containers hold disposable test data only.

The original redacted production exception and actual provider output were not inspected. These tests establish supported behavior and recovery guarantees, not the exact cause of that production event. No production data or live provider call was required.

## Acceptance transcript

This is the tested harness conversation, with receipt acknowledgments omitted. `REVIEW ...` is the harness presenter text; the summary DTO separately carries the same date, amount, and currency. It is not a live Telegram transcript.

1. The user sends:

   ```text
   Fecha : 24 Nov 2026 at 17:12
   Comercio: Mercadona
   Importe: 13,79 €
   Tarjeta:CREDITO SANTANDER
   Nombre: Mercadona
   Transacción: Mercadon
   ```

2. To exercise recovery, the provider stub returns `fechaRaw: '2026-11-31'`, amount `13.79`, and currency `EUR`. Application validation rejects the impossible calendar date.
3. The exact owned receiving revision is reset to `IDLE`, with null payload and expiry. After reloading that committed revision, Gastto sends:

   ```text
   No pude interpretar la fecha de este gasto. No lo guardé.

   Volvé a enviarlo con una fecha como 2026-11-24.
   ```

   No summary, spreadsheet append, or expense record exists at this point.
4. The user resends the complete receipt. The provider stub now returns `fechaRaw: '24 Nov 2026 at 17:12'`, amount `13.79`, and currency `EUR`.
5. The conversation reaches `EXPENSE_REVIEW`. The harness presents `REVIEW 2026-11-24 13.79 EUR`; the DTO has date `2026-11-24`, amount `13.79`, and currency `EUR`. There is still no financial write.
6. The user sends `sí` after review presentation. One spreadsheet append and one expense record are created, with expense date `2026-11-24`.
7. Reprocessing the same confirmation produces no second append or expense record.

The same receipt also reaches review directly, without a preceding failure. Recovery is exercised from both `IDLE` and an existing `EXPENSE_RECEIVING` attempt, with semantic routing off and enabled.

## Preservation checks

- Stale/expired compare-and-swap outcomes, newer drafts, invalidated leases, and financial claims cannot produce a successful reset notice.
- A failed reset write propagates as a persistence failure. It is never labeled recovered or converted into another generic reset by semantic dispatch.
- A newer persisted revision or an unavailable post-recovery read suppresses resend guidance, even if the previous attempt had reset successfully.
- Ordinary clarification answers and replacement expenses with invalid dates retain the previous clarification revision. Replacement interruption copy is emitted only after successful interpretation; the queue batch count is forwarded unchanged.
- Invalid correction dates retain the old review and correction state.
- A retained queued receiving payload cannot be reset by an omitted caller batch count. Failed queued interpretation leaves the same FIFO item durable. An already confirmed predecessor remains saved exactly once; the failed successor produces no review, reset notice, or batch-completion copy.
- Date diagnostic logs include only code, stage, reason, user/correlation metadata, with no receipt text, extracted amounts, credentials, or provider response.

## Validation commands

- Targeted recovery, registration, semantic-dispatch, queue, and worker suites: `vitest run` against the five changed specs.
- Required PostgreSQL/Redis harness: `RUN_POSTGRES_INTEGRATION=true pnpm test tests/integration/semantic-router-expense-flows.integration.spec.ts`.
- Ship checks: `pnpm run lint && pnpm run typecheck && pnpm test`.

Docker must be available for the harness (`postgres:16-alpine` and `redis:7-alpine`). Its required flag turns missing Docker into a failure instead of a silent skip. These commands need access to disposable containers and local test ports; the filesystem/network sandbox cannot provide those prerequisites. The final stable-code run passed 214 files / 3,041 tests, with 13 files / 79 tests skipped. The 22-scenario expense-flow harness passed, including its required Docker runs. Lint and TypeScript passed; final targeted checks also passed. Detailed results are recorded in the plan's Phase 2 execution record.

No database schema, persisted payload contract, or architecture decision changed, so no migration or new ADR was required. The related missing-date acceptance criterion in `T-E1-US-06-02.md` is checked; unrelated backlog criteria remain unchanged.

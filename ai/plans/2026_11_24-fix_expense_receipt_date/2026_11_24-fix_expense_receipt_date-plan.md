# Fix receipt date parsing and expense recovery

## Goal

Interpret receipt dates such as `24 Nov 2026 at 17:12` without throwing an unexpected `RangeError`, preserving the written calendar day. Handle unsupported or impossible dates explicitly and recover failed initial registration so the user can resend the expense without cancelling a stranded draft.

## Context

- Approved scope: two implementation phases and the contracts below, on the existing `feat/add-category-during-expense-correction` branch. Approval covers writing this plan; implementation requires an explicit request.
- Keep the separate [onboarding category review plan](../2026_11_24-fix_onboarding_category_review/2026_11_24-fix_onboarding_category_review-plan.md) unchanged.
- Reported input:

  ```text
  Fecha : 24 Nov 2026 at 17:12
  Comercio: Mercadona
  Importe: 13,79 €
  Tarjeta:CREDITO SANTANDER
  Nombre: Mercadona
  Transacción: Mercadon
  ```

- The worker logged `UNEXPECTED_HANDLER_ERROR` with `errorType: RangeError`. The message was redacted, so the exact production exception and provider-extracted date remain unconfirmed.
- Executing the current `resolveExpenseCalendarDate` implementation locally with `24 Nov 2026 at 17:12` reproduces `RangeError: Invalid extracted expense date`. Both `24 Nov 2026` and `2026-11-24` resolve to `2026-11-24`.
- The ISO-shaped fast path currently accepts `2026-11-31`, although November has only 30 days. Numeric dates use stronger calendar validation, making validation inconsistent across formats.
- `ExtractedExpenseSchema` accepts any string for `fecha_raw`. `RegisterExpenseUseCase.interpret` catches typed extraction failures around the LLM call, but date resolution happens later inside `buildReviewPayload`. A date failure therefore bypasses initial extraction recovery and reaches generic worker handling.
- The reported cancellation after failure is consistent with a retained receiving flow. Repeating the same receipt can fail again regardless of the preceding settings cancellation; production state and LLM output were not inspected.

### References

- [Repository instructions](../../../AGENTS.md), [plan conventions](../../../docs/plans/plan-conventions.md), and [testing guidelines](../../../docs/testing/guidelines.md).
- [Architecture decisions](../../../docs/adr/adr.md): extraction adapters, persisted FSM, asynchronous processing, and write-with-confirmation.
- [Expense summary review](../../../docs/features/expense-summary-review.md), especially receipt calendar dates and initial extraction recovery.
- [Clarification behavior](../../../docs/features/clarification-request.md), [expense correction](../../../docs/features/expense-correction.md), and [conversation state management](../../../docs/features/conversation-state-management.md).
- [Data model](../../../docs/architecture/data-model.md): conversation revisions, expense payloads, and pending-message queue.
- [Expense registration](../../../src/application/use-cases/expense/RegisterExpense.ts) and [its tests](../../../src/application/use-cases/expense/RegisterExpense.spec.ts).
- [Extraction schema and prompt](../../../src/infrastructure/adapters/llm/expenseExtraction.ts).
- [Existing recovery use case](../../../src/application/use-cases/expense/RecoverExpenseExtraction.ts) and [typed LLM errors](../../../src/domain/errors/LLMExtractionError.ts).
- [State transition ownership](../../../src/application/use-cases/conversation/TransitionConversationState.ts), [worker](../../../src/interfaces/workers/message.worker.ts), and [worker tests](../../../src/interfaces/workers/message.worker.spec.ts).
- [Expense copies](../../../src/application/copies/expense.copies.ts) and [existing correction date handling](../../../src/application/use-cases/expense/CorrectExpenseUseCase.ts).

### Boundaries and acceptance criteria

- Valid receipt input reaches a visible review with `resolvedDate: '2026-11-24'`, amount `13.79`, and currency `EUR`. Review and explicit confirmation remain required before writing.
- Preserve the written calendar day rather than converting local receipt time through UTC. Use explicit supported formats rather than environment-dependent free-form `Date.parse` behavior.
- Missing date retains the current local-day default. A present but invalid or unsupported date must never silently become today.
- Preserve supported ISO date-only, day-first numeric, and written-month inputs. Explicitly document supported receipt time suffixes and existing relative-date compatibility after inspecting call sites and tests.
- Validate real month lengths and leap years consistently. Ambiguous or unsupported input receives a controlled rejection rather than a guessed date.
- Only the failed initial receiving attempt may reset to `IDLE`. Clarification, correction, queued work, newer drafts, expired/stale ownership, and unresolved financial claims retain their existing protections.
- Provider output is untrusted even after adding prompt guidance. Do not depend on live provider behavior for regression tests.
- Keep logs structured and safe: diagnostic code, stage, and correlation metadata without receipt text, extracted financial values, credentials, or raw provider responses.
- No production data or external APIs are needed for validation. Use disposable integration stores and mock provider/messaging boundaries. Report unavailable integration prerequisites accurately.

## Phases

### Phase 1: Normalize and validate dates before expense review

Deliver the reported receipt as a correct expense review and replace unexpected date exceptions with an explicit, typed failure that callers can handle safely.

#### Contracts

- Introduce a reusable application date resolver with the proposed signature `resolveExpenseCalendarDate(rawDate: string | null, now: Date): ExpenseCalendarDateResult`.
- Define `ExpenseCalendarDateResult` as `{ kind: 'resolved'; date: string; source: 'explicit' | 'default' } | { kind: 'invalid'; reason: 'unsupported-format' | 'invalid-calendar-date' }`. A resolved date must be a validated `YYYY-MM-DD`; capture `now` once per attempt to keep defaults deterministic.
- Update `RegisterExpenseUseCase.interpret` and review construction to consume this result before persisting a review. Invalid results become a specific application failure rather than a `RangeError`; do not broadly catch unrelated programming errors.
- Add a safe application error code such as `EXPENSE_DATE_INVALID`, retaining the reason for internal diagnosis. Keep provider transport errors distinct from post-extraction date-validation failures.
- Update the shared extraction prompt to request an explicit calendar date in `YYYY-MM-DD` when resolvable, preserving the user's stated day and using null when no date is supplied. Do not change the nullable string wire shape or rely on prompt compliance as validation.
- Add Spanish invalid-date guidance, for example: `No pude interpretar la fecha de este gasto. Usá el formato AAAA-MM-DD, por ejemplo 2026-11-24.` Include cancellation guidance only when the effective persisted state supports it. Phase 2 adds successful-reset guidance.
- Add resolver tests plus registration, prompt-contract, and worker regression cases.

#### To-do actions

- [x] Inspect existing date call sites and tests, identifying formats and relative-date behavior that must remain compatible. Keep correction changes limited to any necessary compatibility adjustment; do not replace an existing review date on invalid input.
- [x] Add a failing regression using the complete reported receipt with a mocked extraction returning `fechaRaw: '24 Nov 2026 at 17:12'`, then implement the resolver and registration integration in the same phase.
- [x] Parse supported formats explicitly: ISO date-only, day-first slash dates, and written English/Spanish month names or abbreviations already supported by the product. Support the reported optional `at HH:mm` suffix and existing comma-separated receipt time; validate time components if present instead of ignoring arbitrary trailing text.
- [x] Validate calendar components for every accepted format, including leap days, month bounds, zero values, and impossible dates. Reject trailing garbage and ambiguous unsupported formats. Avoid UTC conversion of receipt calendar components.
- [x] Preserve the missing-date default with a supplied clock value. Verify non-UTC time zones and midnight boundaries; valid written dates must not shift to a neighboring day.
- [x] Resolve the date before building the review payload. Return a typed validation failure for unsupported/impossible explicit dates, and handle it specifically in the worker without routing it to `UNEXPECTED_HANDLER_ERROR`.
- [x] Update provider prompt guidance and relevant prompt assertions while retaining deterministic validation for any returned string.
- [x] Test the complete receipt, `24 Nov 2026`, ISO and numeric dates, written Spanish months, null date, valid/invalid leap days, `2026-11-31`, `31/11/2026`, invalid time suffixes, unsupported text, and timezone independence. Assert invalid dates never produce a persisted review, expense record, spreadsheet append, or success message.
- [x] Update implemented date-format and invalid-date behavior in the affected feature docs and `docs/features/README.md`.
- [x] Run targeted resolver, registration, provider prompt, and worker tests, then `pnpm test`. Resolve regressions and distinguish unavailable integration execution from a pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

#### Phase 1 execution record (2026-11-25)

- Completed on `feat/add-category-during-expense-correction`. Existing worker-test edits and graph artifacts were preserved; the separate onboarding plan was not changed.
- Reproduced the complete receipt as a failing registration test (`RangeError`) before implementation. It now reaches review with `2026-11-24`, `13.79`, and `EUR`, without record creation or spreadsheet append.
- Added the reusable application resolver and `EXPENSE_DATE_INVALID`. Date validation runs immediately after extraction, outside provider-error recovery, before clarification/classification/review persistence. Semantic dispatch propagates this precise failure to controlled worker guidance without generic reset.
- Reused the resolver for date corrections so invalid dates preserve the pending review. Spanish relative dates (`hoy`, `ayer`, `mañana`) resolve locally; removed environment-dependent free-form parsing. Only null defaults to the captured local day.
- Verified explicit formats, month lengths, leap years, validated `at HH:mm` / comma time suffixes, unsupported strings, safe diagnostic metadata, and state-aware cancellation guidance. Resolver tests passed in Madrid, Los Angeles, and Kiritimati; registration/correction tests also passed in Los Angeles (97 tests).
- Targeted resolver, registration, correction, semantic dispatch, shared prompt, and worker suites: 442 tests passed. Final `pnpm run lint && pnpm run typecheck && pnpm test`: passed, with 214 test files / 3,006 tests passed and 13 files / 79 tests skipped. Opt-in PostgreSQL coverage was not enabled; Phase 2's new PostgreSQL/Redis recovery regression remains pending.
- Initial sandbox checks could not open pnpm's local database, bind Fastify ports, or access a container runtime. Re-running the standard commands outside the sandbox passed, including the Redis integration suites. No live provider or production data was used. The original redacted production exception remains uninspected.
- Feature docs and their index now describe implemented formats and controlled rejection. Automatic recovery of date failures remains exclusively in Phase 2. No commit created; review/continuation and commit choices are presented to the user at this handoff.

### Phase 2: Recover invalid-date attempts and verify safe re-entry

Allow a user to resend an expense after invalid-date rejection without a stranded initial draft, while preserving concurrent or previously active work.

#### Contracts

- Extend the application recovery outcome/error contract to represent a recovered date-validation failure in addition to recovered LLM extraction failures. Preserve the distinction between the original failure and successful state recovery; do not label a failed reset as recovered.
- Keep `RecoverExpenseExtraction.execute(observed)` ownership semantics: reset only the exact owned receiving revision with no financial execution claim. Reuse it for the new typed initial date failure or extract a narrowly named shared recovery operation if needed.
- Extend worker handling to send date-specific resend guidance only after a successful reset. Proposed copy: `No pude interpretar la fecha de este gasto. No lo guardé. Volvé a enviarlo con una fecha como 2026-11-24.`
- Route invalid dates during clarification, queued interpretation, or correction to state-appropriate guidance without clearing their drafts or queue. A stale attempt must not notify the user that another attempt was reset.
- Extend recovery, registration, worker, and PostgreSQL/Redis integration tests for date failure, resend, and final confirmation.

#### To-do actions

- [ ] Apply the existing initial-attempt eligibility checks to the new date failure and capture the appropriate observed receiving revision. Do not widen the recovery block to swallow classifier, persistence, or other unrelated errors.
- [ ] Reset the eligible failed attempt to `IDLE` with null payload and expiry using the existing CAS precondition. Propagate persistence failures and treat stale/invalidated execution consistently with existing recovery paths.
- [ ] Emit the recovered date copy only after committed recovery. Use current persisted state for cancellation or retry guidance when recovery is unavailable; do not promise a reset that did not occur.
- [ ] Verify that invalid-date clarification, replacement, and queued interpretation do not clear existing work or advance the queue incorrectly. Preserve queue counts, pending reviews, and financial execution claims.
- [ ] Add tests for successful reset, stale revision, lease invalidation, newer draft, failed recovery persistence, queued interpretation, clarification/correction preservation, and safe logging. Assert no record or row is written and no false recovery/completion message is sent.
- [ ] Add a PostgreSQL/Redis regression using the existing expense-flow integration harness: invalid extracted date, controlled recovery, corrected resend, visible review with the expected day/amount/currency, explicit confirmation, and exactly one write despite duplicate confirmation. Mock the LLM, Sheets, and messaging boundaries, not core application behavior or DB repositories.
- [ ] Verify the reported valid receipt works directly after Phase 1 and after a failed prior attempt. Record an acceptance transcript and retain the limitation that the original redacted production exception was not directly inspected.
- [ ] Update expense summary, clarification, correction, and conversation recovery docs where behavior changed, plus `docs/features/README.md`. Update payload/data-model documentation only if persisted contracts changed; record a new ADR and its index only if implementation introduces an architectural decision.
- [ ] Run targeted recovery and integration tests, followed by `pnpm test`. Record integration prerequisites and any unexecuted checks; after implementation, check off satisfied related user-story acceptance criteria where applicable.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Review the completed Phase 1 and choose whether to commit it, then execute Phase 2 when requested.

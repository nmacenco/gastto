# Spreadsheet compatibility and conversational recovery

## Goal

Accept only native Google spreadsheets in Google destination selection and give users actionable recovery instructions when spreadsheet operations fail. Make cancellation discoverable in active flows that permit it, while preserving financial execution guards and state-bound authorization.

## Context

The user approved the following three phases and proposed contracts on 2026-11-15. The user subsequently authorized implementation of all three phases on a new branch; intermediate review pauses are superseded by that explicit instruction.

Source inspection confirmed that Drive discovery includes XLSX and ODS, file validation requests only `id`, and Sheets maps HTTP 400/404 to `STRUCTURE_ERROR` without retaining provider diagnostics. Initial sheet listing can show technical error text followed by an indiscriminate retry instruction. Global cancellation already precedes onboarding/settings step parsing and is blocked by financial execution claims. The incident workbook itself was not available for inspection; the code supports the reported failure mechanism but does not independently establish that particular provider response.

Relevant source:

- [Drive adapter](../../../src/infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter.ts), [cloud storage port](../../../src/domain/ports/cloudStorage.ts), [Sheets adapter](../../../src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts), [spreadsheet errors](../../../src/domain/errors/SpreadsheetError.ts), and [discovery errors](../../../src/domain/errors/FileDiscoveryError.ts).
- [File selection](../../../src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts), [sheet selection](../../../src/application/use-cases/spreadsheet/HandleSheetSelection.ts), and [access validation](../../../src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts).
- [Settings destination flow](../../../src/application/use-cases/spreadsheet/SettingsDestinationFlow.ts), [settings vocabulary flow](../../../src/application/use-cases/spreadsheet/SettingsVocabularyFlow.ts), and [spreadsheet use cases](../../../src/application/use-cases/spreadsheet/).
- [Onboarding copies](../../../src/application/copies/onboarding.copies.ts), [settings copies](../../../src/application/copies/settings.copies.ts), [access copies](../../../src/application/copies/access.copies.ts), and [expense copies](../../../src/application/copies/expense.copies.ts).
- [Message worker](../../../src/interfaces/workers/message.worker.ts) and [conversation cancellation](../../../src/application/use-cases/conversation/CancelConversationFlow.ts).

Required implementation references:

- [Repository instructions](../../../AGENTS.md), [ADRs](../../../docs/adr/adr.md), [testing guidelines](../../../docs/testing/guidelines.md), and [observability](../../../docs/architecture/observability.md).
- [File selection](../../../docs/features/select-spreadsheet-file.md), [sheet selection](../../../docs/features/select-sheet.md), [access validation](../../../docs/features/validate-spreadsheet-access.md), and [cloud connection](../../../docs/features/cloud-storage-connection.md).
- [Mapping inference](../../../docs/features/infer-and-propose-column-mapping.md), [mapping correction](../../../docs/features/confirm-or-correct-column-mapping.md), [category confirmation](../../../docs/features/category-confirmation.md), and [payment methods](../../../docs/features/payment-methods.md).
- [Chat settings](../../../docs/features/chat-spreadsheet-settings.md), [account access](../../../docs/features/telegram-access-approval.md), [state management](../../../docs/features/conversation-state-management.md), and [incoming routing](../../../docs/features/incoming-message-routing.md).
- [Clarification](../../../docs/features/clarification-request.md), [expense review](../../../docs/features/expense-summary-review.md), [expense correction](../../../docs/features/expense-correction.md), [expense confirmation](../../../docs/features/expense-confirmation.md), and [expense cancellation](../../../docs/features/expense-cancellation.md).

### Agreed behavior and boundaries

- Use existing navigation. Initial setup recovery says to send `cancelar`, then `empezar`. Settings destination recovery says to send `cancelar`, then `configuración`, then choose option `3` to select another file. Do not introduce a new back-navigation transition.
- Unsupported files must be saved as native Google spreadsheets by the user, who then selects the converted file. Do not infer compatibility from the extension or URL, and do not convert files automatically.
- An error or re-prompt that retains a cancellable flow must provide a useful continuation and `Escribí cancelar para salir`. Derive eligibility from the effective persisted state and financial guards, not just the state name or the incoming snapshot.
- Do not offer cancellation after reaching `IDLE`, or when a financial execution claim prevents it. Preserve manual-resolution guidance for unresolved operations. Cancelling a draft may advance its pending queue; cancelling a save retry retains its existing queue behavior.
- A 400 response alone does not identify an unsupported file. Classify compatibility from MIME metadata, distinguish permanent from transient failures, and preserve bounded, allowlisted diagnostic metadata without exposing raw provider text, credentials, request URLs, or spreadsheet contents.

## Phases

### Phase 1: Compatible file selection and actionable Sheets failures

Deliver an independently usable fix in both onboarding and settings: native-only discovery, explicit rejection of unsupported selections, and actionable errors for listing or reading sheets.

Public contracts:

- Change `CloudStoragePort.validateFileAccess(fileId, accessToken, provider)` to return `Promise<FileAccessValidationResult>`, with `{ kind: 'accessible' } | { kind: 'inaccessible' } | { kind: 'unsupported-type' }`. Authentication, transport, and malformed-response failures remain typed exceptions. Update all consumers and test doubles atomically.
- Keep discovery method signatures; Google results contain only `application/vnd.google-apps.spreadsheet` files.
- Extend `SpreadsheetErrorOptions` and `SpreadsheetError` with optional safe diagnostics, proposed as `providerDiagnostic?: { httpStatus: number; status?: string; reason?: string }`. Accept only bounded allowlisted status/reason values. Preserve existing `code`, `retryable`, and `outcomeUnknown` behavior, especially for mutations.
- Add application-owned copies for unsupported format, permanent read/list failure, transient failure, and contextual file recovery. No raw exception interpolation in these paths.
- Adapter, file-selection, sheet-selection, settings-destination, and worker regression suites gain the cases below.

Tasks:

- [x] Read the relevant canonical docs and identify existing tests and every consumer of the changed port before editing.
- [x] Restrict Drive listing/search queries to the native Google spreadsheet MIME type and reject unsupported results defensively. Preserve search, ordering, and displayed-reference semantics.
- [x] Request `id,mimeType` during file validation. Validate the response shape; missing or malformed metadata must not become successful access or an unsupported-format assertion. Preserve authorization refresh behavior and inaccessible-file handling.
- [x] Update numeric, semantic displayed-reference, and direct-link selection in onboarding and settings to handle each result. Revalidate historical list selections so an older XLSX/ODS entry cannot bypass the check. Reject before sheet discovery or destination activation.
- [x] Explain conversion to a Google spreadsheet, then offer a compatible selection or cancellation while retaining the appropriate file-selection state.
- [x] Preserve safe provider diagnostics for Sheets failures, including malformed/non-JSON error bodies. Ensure diagnostic parsing cannot replace the original error classification or weaken financial uncertainty handling. Use existing structured logging conventions.
- [x] Classify initial sheet listing, recovery listing, and header-reading errors consistently. Preserve existing OAuth refresh/reconnection rules. Offer retries only where meaningful; permanent failures offer the existing contextual recovery sequence.
- [x] Replace inline technical messages and cover empty sheet lists, invalid selections, and unavailable headers with valid continuation instructions. Ensure advertised commands are handled by the retained state.
- [x] Test XLSX/ODS exclusion from lists/searches, rejection by direct URL and historical list selection, native spreadsheet success, missing MIME, inaccessible files, auth refresh, network/5xx failures, permanent 400, and unknown/malformed provider errors. Assert unsupported files cause no Sheets call, success confirmation, or configuration activation.
- [x] Test initial/recovery listings and header reads, including a successful retry and the complete cancellation/restart sequence in each context. Assert message, persisted state, and subsequent command behavior together.
- [x] Update file-selection, sheet-selection, and settings feature docs plus `docs/features/README.md`; correct stale access-validation descriptions where encountered. Document diagnostic conventions if extended. Record the native-format decision in an ADR using the template and update `docs/adr/README.md`.
- [x] Run `pnpm test`; fix regressions, including append/delete uncertainty tests affected by shared error handling.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase. (User authorized proceeding through the complete plan.)

### Phase 2: Consistent onboarding and settings recovery

Make remaining onboarding and configuration errors and re-prompts self-explanatory without changing the guarded cancellation lifecycle.

Public contracts:

- Update onboarding/settings copies for provider selection, discovery, access checks, mapping recovery/corrections, category hierarchy edits, payment detection, and candidate configuration failures.
- Give account-replacement invalid-email feedback a dedicated copy or explicit context parameter so admission feedback does not incorrectly promise cancellation. Update replacement persistence-failure feedback similarly.
- Expand the corresponding use-case and worker tests with state-aware cancellation assertions and candidate-preservation checks.

Tasks:

- [x] Inventory error and re-prompt branches in the bounded onboarding/settings scope, recording effective state, valid continuation, cancellation eligibility, and current tests. Inspect shared-copy call sites before changing text.
- [x] Add useful continuation and cancellation guidance to invalid-provider, file discovery/access, read/write validation, mapping resumption/correction, and category correction paths. Retain existing guidance where already sufficient and avoid duplicate instructions.
- [x] Update settings mapping/header failures, payment detection, vocabulary edits, invalid replacement email, and failed replacement persistence. Move remaining touched inline user-facing messages into application copy modules.
- [x] Match messages to completed transitions, including returns to sheet selection or `IDLE`. Preserve candidate isolation, previous active configuration/credentials, revision checks, expiry, and OAuth cleanup.
- [x] Test representative errors and re-prompts in each onboarding/settings group through message, persisted state, and `cancelar`. Cover changed state after recovery, expired/stale replies, mapping and vocabulary drafts, and replacement-account failures.
- [x] Assert cancellation cannot activate candidates or overwrite the existing destination/account, and that initial admission feedback does not acquire an unsupported cancellation instruction.
- [x] Update each affected canonical feature doc and `docs/features/README.md` with implemented behavior only.
- [x] Run `pnpm test` and fix failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase. (User authorized proceeding through the complete plan.)

### Phase 3: Expense recovery and state-aware shared responses

Complete the recovery rule for expenses and generic/semantic feedback while preserving financial execution protection and pending-expense behavior.

Public contracts:

- Add cancellation guidance to expense clarification, correction, unresolved payment, invalid subcategory, and cancellable save-retry feedback. Save-retry exits also instruct users to verify the spreadsheet before registering again.
- Introduce an application-level recovery context for shared response composition, proposed as `'cancellable' | 'idle' | 'financially-blocked' | 'unknown'`. Resolve it from the current conversation and existing authorization guards. Shared generic/semantic copies receive this context rather than assuming cancellation is always available; unknown context does not promise an exit.
- Update worker, semantic dispatch, expense use-case, and cancellation integration suites with the cases below.

Tasks:

- [x] Inspect expense and semantic dispatch response paths and their cancellation bindings, including review authorization, queued continuation, retry claims, and stale/expired references.
- [x] Implement the recovery-context resolver using existing financial-claim and cancellation rules. Integrate it at shared error/semantic response sites with a current-state read when execution may have changed the original snapshot. If the current state cannot be established, use bounded guidance without promising cancellation.
- [x] Update expense error/re-prompt copies and consumers. Provide a continuation accepted by the retained state; preserve revision-bound review actions and the ordering of cancellation and queue advancement.
- [x] Keep financially blocked replies directed to manual resolution without cancellation, automatic retry, or claims that an append/delete was rolled back. Preserve the administrator guidance already used for unresolved outcomes.
- [x] Test clarification, correction, review, unresolved payment, invalid subcategory, and save retry. Verify message, persisted state, and cancellation result; include pending-queue advancement where appropriate.
- [x] Test generic failures and semantic ambiguous/stale/expired references in cancellable states, after a transition to `IDLE`, with a changed revision, and when current-state lookup fails. Ensure no indiscriminate cancellation suffix or stale continuation instruction.
- [x] Test uncertain append/retry/undo outcomes with durable claims: no offered cancellation, no state clearing, no duplicate write/delete, no candidate activation, and manual-resolution feedback. Test unclaimed retry cancellation separately, including spreadsheet-verification guidance.
- [x] Update affected expense, routing, and state-management feature docs plus `docs/features/README.md`. Update any related existing user-story task acceptance checkboxes only after the implemented criteria are verified.
- [x] Run `pnpm test` and verify the combined three-phase regression matrix. Follow repository instructions for integration dependencies; never read secret files to run checks, and report unavailable checks explicitly.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase. (User authorized proceeding through the complete plan.)

## Next step

All three phases are complete; review the changes and decide whether to commit them.

## Execution evidence

- Branch: `fix/spreadsheet-compatibility-flow-recovery`.
- [Recovery inventory and test matrix](./recovery-matrix.md).
- Implementation and canonical docs completed. `pnpm lint` and `pnpm typecheck` pass. `RUN_POSTGRES_INTEGRATION=true pnpm test` passes all 2,815 tests across 208 files, with no skipped tests. Prettier checks for changed TypeScript files and `git diff --check` also pass.
- No migration, deployment, live provider request, or commit was performed.

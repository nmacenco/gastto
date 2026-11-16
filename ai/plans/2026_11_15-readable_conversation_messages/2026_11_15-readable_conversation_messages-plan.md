# Readable conversation messages

## Goal

Make chat responses easier to scan through explicit paragraphs, readable lists, and a separate cancellation footer. Introduce a small message composer and migrate the existing flows in four independently reviewable phases, preserving valid commands and recovery behavior.

## Context

The user approved the composer approach and four phases. The exact replacement for `Escribí cancelar para salir.` is **`Escribí cancelar si quieres salir.`**. Implementation of the current phase was authorized through `execute-plan`; later phases remain pending their review checkpoint.

### Source and documentation

- [Spreadsheet recovery copies](../../../src/application/copies/spreadsheet-recovery.copies.ts) concatenate explanations, recovery actions, and cancellation instructions.
- [Onboarding copies](../../../src/application/copies/onboarding.copies.ts), [settings copies](../../../src/application/copies/settings.copies.ts), and [access copies](../../../src/application/copies/access.copies.ts) contain prompts, menus, lists, and recovery messages to migrate.
- [Expense copies](../../../src/application/copies/expense.copies.ts) include clarification messages, financial warnings, and `recoveryGuidance`, which currently detects cancellation wording in strings.
- [Recovery context](../../../src/application/services/recovery-context.ts) distinguishes cancellable, idle, financially blocked, and unknown contexts.
- [Message worker](../../../src/interfaces/workers/message.worker.ts) selects guidance using current conversation state. Formatting must preserve this behavior.
- [Messaging port](../../../src/application/ports/output/messaging.port.ts) accepts text strings. The composer belongs in the application layer, before transport delivery.
- [Telegram messenger](../../../src/infrastructure/adapters/telegram/TelegramMessengerAdapter.ts) already handles text fragmentation. Preserve that behavior; paragraphs must not become separate sends.
- [Architecture decisions](../../../docs/adr/adr.md) provide the messaging, conversation, and financial reliability constraints.
- [Incoming message routing](../../../docs/features/incoming-message-routing.md), [conversation state management](../../../docs/features/conversation-state-management.md), and [testing guidelines](../../../docs/testing/guidelines.md) define behavior and regression requirements.

The migration inventory must include inline user-facing messages in use cases, services, workers, and presenters, not only the copies directory. The files above are starting points, not an exhaustive inventory.

### Composition contract

Introduce a pure application utility, proposed at `src/application/copies/compose-message.ts`, with this minimal contract:

```ts
export interface MessageBlocks {
  readonly explanation?: string;
  readonly action?: string;
  readonly exit?: string;
}

export function composeMessage(blocks: MessageBlocks): string;

export const CANCEL_EXIT_HINT = 'Escribí cancelar si quieres salir.';
```

- Render present blocks in the fixed order `explanation`, `action`, `exit`, separated by exactly `\n\n`.
- Omit absent or whitespace-only blocks and trim only block boundaries. Preserve internal newlines, indentation, URLs, and punctuation. An empty composition returns an empty string; callers must not send it.
- Keep one intention per paragraph. Author additional paragraphs explicitly within a block when necessary, including a separate paragraph for a financial warning.
- Use one newline between list items, numbered lists for ordered steps, and bullets for alternatives. Preserve existing selectable option numbers and category hierarchy.
- Keep short confirmations as a single line where appropriate. Do not force all messages through the composer.
- Keep copy ownership in the existing feature copy modules. The composer owns spacing; it does not infer structure from prose, translate text, decide valid commands, or read conversation state.
- Make cancellation ownership explicit at each composition boundary. A copy that supplies its own exit must not also receive one from a wrapper. Replace text-based duplicate detection with explicit ownership when migrating shared expense guidance.
- Supply the standard exit only when the current flow allows optional cancellation. Preserve existing financial protection, current-state checks, and unknown-context fallback behavior.
- If cancellation is a required first step of recovery, show it in the numbered action sequence and omit the optional exit footer.
- Use plain text line breaks. Preserve existing channel escaping, keyboards, and transport limits; do not add a Markdown requirement or a formatting pass in the transport adapters.

### Representative outputs

Retryable spreadsheet failure:

```text
No pude consultar la planilla por un problema temporal.

En unos segundos, enviá reintentar para volver a intentar.

Escribí cancelar si quieres salir.
```

Permanent failure requiring settings restart:

```text
No pude leer las hojas o su estructura.

Revisá el archivo en Google Sheets. Para elegir otro archivo:
1. Escribí cancelar para salir de la configuración actual.
2. Escribí configuración.
3. Elegí la opción 3.
```

The second example intentionally has no optional exit footer: cancellation is already part of the recovery sequence. Use the existing command appropriate to each flow; onboarding restarts with `empezar`.

## Phases

### Phase 1: Composer and readable spreadsheet recovery

**Description:** Deliver the first visible slice by formatting file and sheet recovery messages with the new composer, including their complete surrounding prompts.

**Contracts:** Add `MessageBlocks`, `composeMessage`, and `CANCEL_EXIT_HINT`. Preserve existing recovery copy function signatures and string return values while changing their displayed layout. Establish representative complete-message assertions and the shared formatting convention.

- [x] Inspect the relevant copy consumers and their tests before modifying shared strings, including any messages reused in non-chat surfaces.
- [x] Implement the pure composer and standard exit constant using the contract above.
- [x] Migrate unsupported-format, empty-sheet, retryable-read, and permanent-read recovery messages in `spreadsheet-recovery.copies.ts`, plus their immediately surrounding file/sheet prompts in onboarding and settings.
- [x] Replace prose recovery chains with numbered steps when cancellation and restart are required. Preserve `reintentar`, custom retry commands, `empezar`, and settings option `3` where currently applicable.
- [x] Ensure composed recovery text integrates with surrounding messages without appending the footer to the last list item or duplicating an existing footer.
- [x] Test block ordering, optional/empty blocks, boundary trimming, and preservation of internal list indentation. Assert representative full messages for unsupported format, retryable failure, and both restart flows.
- [x] Retain flow assertions for candidate preservation, retry classification, and valid continuation; do not replace behavioral checks with text-only checks.
- [x] Create `docs/features/conversational-message-formatting.md` documenting only the implemented convention and examples. Update the relevant recovery sections in [file selection](../../../docs/features/select-spreadsheet-file.md), [sheet selection](../../../docs/features/select-sheet.md), and [settings](../../../docs/features/chat-spreadsheet-settings.md), plus `docs/features/README.md`.
- [x] Run the composer and affected file/sheet flow tests and review the representative rendered text.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Onboarding and settings messages

**Description:** Apply the convention across the remaining setup and settings conversations, preserving their list structure and commands.

**Contracts:** Update user-visible text in onboarding, settings, access replacement, and related inline messages. Keep existing copy entry points where practical; any extracted inline copy functions return strings and remain feature-owned.

- [x] Inventory the remaining onboarding/settings/access messages and their immediate consumers, including OAuth callbacks, destination selection, vocabulary editing, mapping, categories, payment methods, and replacement email flows.
- [x] Separate explanation, requested action, examples/options, and optional exit. Move cancellation off the final list item, including sheet re-prompts.
- [x] Preserve menu numbering, mapping examples, nested categories, links, and command spelling. Keep existing concise success messages concise.
- [x] Extract repeated inline wording into the appropriate feature copy module where needed; avoid creating a central registry for all application text.
- [x] Apply the exact standard footer only where cancellation is supported. Preserve the distinction between initial access admission and cancellable email replacement.
- [x] Audit shared OAuth/chat/HTML consumers before modifying common strings so chat formatting does not damage another surface.
- [x] Add or update representative complete-message assertions for a selection list, settings menu, mapping correction, category/payment prompt, and replacement-email error. Keep existing transition and persistence assertions.
- [x] Update the relevant sections in [cloud connection](../../../docs/features/cloud-storage-connection.md), [access validation](../../../docs/features/validate-spreadsheet-access.md), [mapping inference](../../../docs/features/infer-and-propose-column-mapping.md), [mapping correction](../../../docs/features/confirm-or-correct-column-mapping.md), [categories](../../../docs/features/category-confirmation.md), [payments](../../../docs/features/payment-methods.md), [settings](../../../docs/features/chat-spreadsheet-settings.md), and [access approval](../../../docs/features/telegram-access-approval.md) where implemented guidance changes. Update `docs/features/README.md` alongside changed feature documents.
- [x] Run the affected onboarding, settings, callback, and access tests and review representative messages from each migrated flow.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Expense messages and shared worker guidance

**Description:** Improve expense prompts and general recovery responses while preserving financial safeguards and effective-state cancellation eligibility.

**Contracts:** Update expense copies and shared recovery composition. Replace cancellation keyword detection in `recoveryGuidance` with an explicit composition boundary using message blocks; migrate all affected callers together. Preserve the existing `RecoveryContext` meanings and final string delivery contract.

- [ ] Resolve the callers of `recoveryGuidance` and the worker's semantic/fallback guidance before changing the helper contract. Classify which layer owns each optional footer.
- [ ] Migrate clarification, correction, review, retry, timeout, and cancellation messages. Preserve amounts, currencies, dates, field ordering, examples, and confirmation commands.
- [ ] Put financial warnings in a separate paragraph. Do not introduce cancellation, retry instructions, or rollback promises for unresolved financial outcomes.
- [ ] Pass explicit message blocks into shared recovery composition instead of scanning text for cancellation words. Retain the financially blocked override and avoid duplicate exits when a copy already owns the footer or includes mandatory recovery steps.
- [ ] Preserve current-state reads, revision guards, and financial claim checks in the worker. Do not derive cancellation eligibility from the incoming message or an earlier state snapshot.
- [ ] Inspect semantic-router pending-question consumers, including `ProjectSemanticRouterInput`, and update affected expectations without changing interpretation or routing behavior.
- [ ] Test complete expense messages and guidance for cancellable, idle, financially blocked, and unknown contexts, including lookup failure and a flow that has already returned to `IDLE`. Retain state-transition and financial-effect assertions.
- [ ] Update relevant guidance in [clarification](../../../docs/features/clarification-request.md), [expense review](../../../docs/features/expense-summary-review.md), [correction](../../../docs/features/expense-correction.md), [confirmation](../../../docs/features/expense-confirmation.md), [cancellation](../../../docs/features/expense-cancellation.md), and [routing](../../../docs/features/incoming-message-routing.md), together with `docs/features/README.md`.
- [ ] Run affected expense, recovery-context, semantic-router, and worker tests; review retry and protected-financial-state messages explicitly.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 4: Cross-flow consistency and delivery verification

**Description:** Finish residual user-facing message migrations and verify the convention consistently across delivery paths.

**Contracts:** Complete remaining chat-copy layout changes and final formatting acceptance coverage. Document the implemented scope and intentional exceptions.

- [ ] Audit user-facing text in copies, use cases, services, worker responses, and presenters for remaining concatenated instructions and old optional-exit literals. Use semantic inspection as well as literal searches; distinguish mandatory restart steps from optional footers.
- [ ] Migrate remaining in-scope messages and record intentional exceptions such as single-line acknowledgements, already structured summaries, and required cancellation steps. Exclude logs, provider prompts, and unrelated HTML/email content from blanket rewrites.
- [ ] Review a representative set spanning success, invalid input, retryable failure, permanent failure, lists, settings restart, and financially protected outcomes. Confirm one intention per paragraph and no redundant footer.
- [ ] Verify plain text paragraph/list preservation through the active Telegram and WhatsApp delivery paths. Preserve existing fragmentation and delivery behavior; new blank lines may affect length boundaries, so check representative long messages without adding extra sends per block.
- [ ] Add delivery-level assertions only where existing coverage does not establish newline preservation or long-message behavior. Avoid snapshots for every string and tests that merely repeat the composer implementation.
- [ ] Reconcile the formatting feature document and affected feature docs with actual behavior; update `docs/features/README.md`. Add an ADR only if implementation introduces an architectural decision beyond the agreed formatting utility, and update the ADR index if one is added.
- [ ] Run `pnpm test`, the required integration checks for affected flows under the repository's documented setup, and formatting checks for changed files. Fix regressions without weakening cancellation or financial-effect assertions.
- [ ] Record validation results, migrated scope, and any unresolved limitations in this plan. Mark implementation tasks complete only after their checks pass.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Review Phase 2 and decide whether to commit it or proceed with Phase 3: expense messages and shared worker guidance.

## Phase 1 validation (2026-11-16)

- Implemented the composer, exact exit hint, shared spreadsheet recovery messages, and surrounding onboarding/settings file and sheet prompts. Extracted settings file/sheet prompts and access-error copies from `SettingsDestinationFlow` into `settingsCopies`.
- Added composer and complete-message tests; updated existing recovery text expectations while retaining state and candidate assertions.
- `pnpm run lint` and `pnpm run typecheck` passed. ESLint emitted the existing package module-type warning.
- `pnpm test --maxWorkers=2` passed: 200 test files passed, 10 skipped; 2,777 tests passed, 50 skipped. Optional integration tests were not enabled for this run.
- Prettier checks passed for all nine changed/new TypeScript files; `git diff --check` passed.
- The first sandbox run encountered port-binding restrictions and outdated text expectations. Text expectations were corrected; the successful validation ran outside the sandbox.
- No commit created. Phases 2–4 remain unimplemented.

## Phase 2 validation (2026-11-16)

- Migrated remaining setup recovery, permissions, mapping corrections, hierarchy errors, settings menu/OAuth guidance, payment review/drafts, and access/replacement-email messages. Existing structured summaries and short acknowledgements retain their layout.
- Added feature-owned payment setup copies and moved vocabulary draft copy into settings copies. Preserved field numbering, nested categories, command spellings, and initial-admission cancellation restrictions.
- Reviewed OAuth copy consumers: callback failures also render in HTML. The route now escapes text before converting newlines to `<br>`; a regression test covers paragraph preservation and markup escaping together.
- Added complete-message assertions for the settings menu, column choices, hierarchy, payment review/draft, initial versus replacement email errors, OAuth URL preservation, and mandatory restart steps.
- `pnpm run lint` and `pnpm run typecheck` passed. ESLint emitted the existing package module-type warning.
- Full suite (`pnpm test --maxWorkers=2`): 201 files passed, 10 skipped; 2,786 tests passed, 50 skipped. Optional integration suites were not enabled.
- Final targeted setup/access/callback/worker/copy run: 28 files and 698 tests passed. Prettier checks passed for the 12 changed/new TypeScript files.
- Updated the affected canonical feature documentation and its index. No commit created by this execution. Phases 3–4 remain pending.

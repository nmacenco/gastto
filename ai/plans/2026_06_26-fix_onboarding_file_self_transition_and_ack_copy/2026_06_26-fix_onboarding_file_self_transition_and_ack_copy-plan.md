# Plan: Fix ONBOARDING_FILE self-transition and generic acknowledgment copy

## Goal

Fix the onboarding file-selection flow so the bot can persist the discovered file list inside the `ONBOARDING_FILE` state without throwing an invalid FSM transition. Also update the generic incoming-message acknowledgment copy so it no longer assumes every message is an expense.

## Context

- The bug was reported during Google Drive onboarding: the user receives the recent-file list and then an error saying Drive could not be queried.
- Root cause: `HandleSpreadsheetFileSelection` tries to self-transition from `ONBOARDING_FILE` to `ONBOARDING_FILE` to store `fileList` in the state payload, but `FSM_TRANSITIONS` in `src/domain/entities/ConversationState.ts` only allows `ONBOARDING_FILE -> ONBOARDING_SHEET`.
- When the self-transition fails, the BullMQ `process-message` job fails and is retried (`attempts: 3`, exponential backoff). On retry, the second call to Google Drive may fail, producing the "No pude consultar tus archivos de Google Drive" message.
- A related issue exists in `HandleSheetSelection.handleIdk`, which attempts a self-transition on `ONBOARDING_SHEET` to store `step: 'idk'`, but `FSM_TRANSITIONS['ONBOARDING_SHEET']` does not allow self-transitions either.
- Documentation reference:
  - `docs/plans/plan-conventions.md`: plan structure and public-contract rules.
  - `docs/features/select-spreadsheet-file.md`: states that `ONBOARDING_FILE` should support self-transition for search/list.
  - `docs/architecture/fsm-states.md`: FSM state descriptions.
  - `docs/adr/adr.md`: FSM transition rules.
- Files involved:
  - `src/domain/entities/ConversationState.ts`: FSM transition table.
  - `src/domain/entities/ConversationState.spec.ts`: FSM transition tests.
  - `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.ts`: listing/search use case.
  - `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.spec.ts`: unit tests.
  - `src/application/use-cases/spreadsheet/HandleSheetSelection.ts`: sheet-selection use case (related `ONBOARDING_SHEET` self-transition).
  - `src/application/use-cases/spreadsheet/HandleSheetSelection.spec.ts`: unit tests.
  - `src/application/use-cases/conversation/RouteIncomingMessage.ts`: generic ack message.
  - `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts`: unit tests.
  - `src/application/copies/shared.copies.ts`: new home for the generic ack copy.

## Phases

### Phase 1: Fix FSM self-transitions for file and sheet selection

Description: Allow `ONBOARDING_FILE` and `ONBOARDING_SHEET` to self-transition so the bot can store intermediate context (`fileList`, `step: 'searching'`, `step: 'idk'`) without failing the BullMQ job. Update affected tests so the mock `TransitionConversationState` validates real transitions instead of silently accepting any call.

- [x] Update `FSM_TRANSITIONS` in `src/domain/entities/ConversationState.ts`:
  - Add `'ONBOARDING_FILE'` to `ONBOARDING_FILE` transitions.
  - Add `'ONBOARDING_SHEET'` to `ONBOARDING_SHEET` transitions.
- [x] Update `src/domain/entities/ConversationState.spec.ts` to assert the new self-transitions are allowed.
- [x] Update `src/application/use-cases/spreadsheet/HandleSpreadsheetFileSelection.spec.ts` so the mock `transitionState.execute` validates the transition using `canTransition` and rejects invalid ones.
- [x] Update `src/application/use-cases/spreadsheet/HandleSheetSelection.spec.ts` so the mock `transitionState.execute` validates the transition using `canTransition` and rejects invalid ones.
- [x] Run the relevant test suites (`ConversationState.spec.ts`, `HandleSpreadsheetFileSelection.spec.ts`, `HandleSheetSelection.spec.ts`) and verify they pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Generic incoming-message acknowledgment copy

Description: Replace the hard-coded "Recibido, procesando tu gasto…" acknowledgment with a copy that does not assume the message is an expense, since the same route handles onboarding and other flows.

- [x] Add a generic `processingAcknowledgment` copy to `src/application/copies/shared.copies.ts` with the text "Recibido, procesando tu mensaje…".
- [x] Update `src/application/use-cases/conversation/RouteIncomingMessage.ts` to use `sharedCopies.processingAcknowledgment()` instead of the hard-coded string.
- [x] Update `src/application/use-cases/conversation/RouteIncomingMessage.spec.ts` to expect the new copy text.
- [x] Run the relevant test suites (`RouteIncomingMessage.spec.ts`) and verify they pass.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete. Review the changes and commit them, or export the conversation and save it alongside the plan.

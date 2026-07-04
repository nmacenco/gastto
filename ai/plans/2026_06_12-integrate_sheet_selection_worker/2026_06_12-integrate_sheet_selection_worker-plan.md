# Plan: Integrate sheet selection into message worker

## Goal

Wire the `HandleSheetSelection` use case into the `message.worker.ts` worker so that `ONBOARDING_SHEET` FSM state messages are delegated to the use case, with a placeholder fallback when the dependency is not wired.

## Context

- `src/interfaces/workers/message.worker.ts` — worker that dispatches FSM states; already has `ONBOARDING_SHEET` wired to `HandleSheetSelection` (lines 133-146) and `MessageWorkerDeps` with optional `handleSheetSelection` (line 34).
- `src/interfaces/workers/message.worker.spec.ts` — tests already cover `ONBOARDING_SHEET` delegation and fallback (lines 388-429).
- `src/main.ts` — DI wiring already constructs and injects `HandleSheetSelection` (lines 303-313, 332).
- `docs/plans/plan-conventions.md` — plan structure conventions.

## Public contracts

- No new public contracts. All integration is already in place.

## Phases

### Phase 1: Verify implementation and close task

The task was already completed as part of T-4.03-04/T-4.03-05. This phase confirms zero regressions and marks the task done.

- [x] Verify `ONBOARDING_SHEET` case in `message.worker.ts` delegates to `handleSheetSelection.execute(...)` with fallback.
- [x] Verify `MessageWorkerDeps` includes `handleSheetSelection?: HandleSheetSelection | null`.
- [x] Verify `src/main.ts` injects `handleSheetSelection` into the worker.
- [x] Verify tests cover both delegation and fallback paths.
- [x] Run `pnpm lint` and `pnpm typecheck`.
- [x] Run `pnpm test` to confirm zero regressions.
- [x] Update acceptance criteria checkboxes in `docs/user-stories/.../HU-4.03-select-the-records-sheet/tasks/T-4.03-06.md`.

## Next step

All phases completed. Task T-4.03-06 has been verified as fully implemented and marked as done.

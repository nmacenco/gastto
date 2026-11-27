# Recovery inventory and verification

## Effective-state rules

Shared worker errors and semantic rejection feedback reload persisted state. The application resolver checks financial claims before state or expiry. An expired or unavailable state yields bounded feedback; an unresolved claim yields administrator guidance. A retry instruction for a settings provider error additionally requires the same persisted revision and state as the failed operation.

| Scope | Retained/effective state | Continuation | Exit and verification |
| --- | --- | --- | --- |
| Drive file validation | ONBOARDING_FILE / SETTINGS_FILE | Select another native file or paste converted link | Explicit cancel; Drive and selection suites assert no Sheets call or activation |
| Initial/recovery sheet listing | ONBOARDING_SHEET | Transient: reintentar; empty-sheet recovery: otra hoja | Permanent: cancelar then empezar; sheet suite covers successful retry |
| Sheet descriptions | ONBOARDING_SHEET | Transient: no sé; permanent: restart file choice | Header/list suites assert safe copy and retained state |
| Settings provider errors | Current unchanged settings revision | Repeat selection only for typed retryable errors | cancelar, configuración, 3; worker regression executes the sequence with real transitions and cancellation |
| Provider / access checks | ONBOARDING_START / VALIDATING_ACCESS | Provider number, reconnect, or reintentar as appropriate | Explicit cancel; existing OAuth refresh and access suites retained |
| Mapping | ONBOARDING_MAPPING / SETTINGS_MAPPING | Existing column/row correction commands | Invalid headers in settings commit SETTINGS_SHEET before response; correction and cancellation suites |
| Category hierarchy | ONBOARDING_CATEGORIES / SETTINGS_MENU | Existing parent-aware edit commands | Explicit cancel; existing draft/commit isolation tests |
| Payment catalogs | SETTINGS_MENU / SETTINGS_CATEGORIES | detectar, agregar, confirmar according to substep | Existing draft, candidate activation, and payment tests |
| Replacement email | SETTINGS_MENU/email_change | Correct or repeat email | Dedicated invalid/persistence copies offer cancel; initial admission copy unchanged |
| Expense clarification/correction | EXPENSE_CLARIFYING / CORRECTING / REVIEW | Amount, currency, natural correction, parent-scoped child | Explicit cancel; existing queue advancement and review authorization suites retained |
| Unresolved payment | EXPENSE_REVIEW | medio de pago: Nombre / agregar medio de pago / sin medio de pago | Explicit cancel; no automatic catalog addition or save |
| Unclaimed save retry | EXPENSE_SAVING_RETRY | Bound reintentar / reconfigurar | cancelar plus spreadsheet verification; existing cancellation queue behavior retained |
| Claimed save/retry/undo | Any state with durable financial claim | Administrator resolution | No exit/retry offer, state clearing or duplicate effect; financial suites and new recovery-context tests |
| Shared stale/ambiguous/error | Fresh state, not incoming snapshot | Current-state or bounded guidance | Worker matrix covers changed revision, IDLE, failed lookup and financial claims |

## Source and test notes

The graph was checked at generation `2026-11-15T09:07:14Z`. Its inbound trace did not resolve calls through the cloud-storage interface; a source search across `src/` and `tests/` identified both consumers and all test doubles. The port change includes the PostgreSQL/Redis option-selection integration harness.

The ADR template has moved from the plan's `docs/adr/template.md` reference to `docs/templates/adr.md`; the new ADR follows that template.

The plan links no dedicated user-story task for this combined recovery change. Existing unrelated acceptance checkboxes were left as recorded. The implementation changes no DB schema and requires no new migration.

## Verification results

Final checks: `pnpm lint` and `pnpm typecheck` passed; `RUN_POSTGRES_INTEGRATION=true pnpm test` passed 2,815 tests in 208 files with no skips. Changed TypeScript files pass Prettier and the diff passes whitespace checks. Tests use mocked external providers and isolated test databases; no live Google account or incident workbook was used.

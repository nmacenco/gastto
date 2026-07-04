# Goal

Extend the `SpreadsheetPort` interface in the Domain layer to support sheet discovery and define the `SheetInfo` value object. This provides the necessary contract for the sheet selection flow in the onboarding use case.

# Context

- `src/domain/ports/services.ts` — Contains `SpreadsheetPort` interface. `getHeaders` is already present. `listSheets` is the new addition.
- `src/domain/entities/` — Contains existing value objects like `CloudFile` (class-based, immutable, with validation). `SheetInfo.ts` does not exist yet.
- `src/domain/entities/CloudFile.spec.ts` — Example of domain layer unit tests for value objects (construction, immutability, equality).
- `docs/adr/adr.md` — ADR-004 covers spreadsheet port decisions. `getHeaders` is already documented there.
- `docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/HU-4.03-select-the-records-sheet/tasks/T-4.03-01.md` — Source task definition.
- `docs/plans/plan-conventions.md` — Plan structure conventions.

# Phases

## Phase 1: Domain Layer Contracts — SheetInfo and listSheets

- [x] Create `src/domain/entities/SheetInfo.ts` as an immutable value object following the `CloudFile` pattern.
  - Fields: `name: string`, `index: number`.
  - Validation at construction time: non-empty `name`, non-negative `index`.
  - Include `equals(other: SheetInfo): boolean` method.
  - `Object.freeze(this)` for immutability.
  - No external library imports in the Domain layer.
- [x] Extend `SpreadsheetPort` in `src/domain/ports/services.ts` with `listSheets(fileId: string): Promise<SheetInfo[]>`. Import `SheetInfo` from `../entities/SheetInfo`.
- [x] Verify `getHeaders(fileId: string, sheetName: string): Promise<string[]>` is present in `SpreadsheetPort` (already confirmed; no action needed).
- [x] Create `src/domain/entities/SheetInfo.spec.ts` with unit tests covering:
  - Valid construction with all required fields.
  - `DomainValidationError` when `name` is empty or whitespace-only.
  - `DomainValidationError` when `index` is negative.
  - Immutability: runtime mutation attempts should throw.
  - Equality: identical properties return `true`, differing properties return `false`.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and type checking. Fix issues if any.
- [x] Run `pnpm test` to ensure all tests pass.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

# Next step

Once Phase 1 is complete and the user approves, the next step is to implement the adapter layer changes (e.g., `GoogleSheetsAdapter.listSheets`) in the dependent tasks (T-4.03-02, T-4.03-04).

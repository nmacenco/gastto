# Fix Column Mapping Consistency

## Goal

Keep the proposed, corrected, and confirmed column mappings consistent, with exactly one field per assigned column. Make the reported conversation recoverable so assigning payment method to column A never resurrects an omitted currency mapping, and confirmation persists exactly the mapping the user reviewed.

## Context

The user approved the contracts and two implementation phases on October 3, 2026. This document is a plan only; implementation requires an explicit execution request.

### Reported scenario and expected outcome

The initial proposal for sheet `T 6` assigns date to B, category to C, subcategory to D, amount to E, and description to F. Currency and payment method are omitted. Column A has an empty header and is a valid manual target. After `medio de pago columna A`, the application unexpectedly displays both currency and payment method in A. Rejection and repeated correction do not recover the flow, and confirmation fails. The message containing `columa A` is interpreted as column `UMA`; `A medio de pago` is not understood.

Expected final mapping: payment method A, date B, category C, subcategory D, amount E, description F, and currency unassigned. Empty headers must not prevent a valid explicit column assignment. Repeated header names in H-L must not change the explicit B-F assignments.

### Findings and evidence limits

- Inference persists only its current results with `upsertMany`, which does not remove previously stored fields absent from the new proposal. The displayed proposal comes from the new inference result, while correction loads its base from the repository. An old currency assignment can therefore reappear during correction.
- Spreadsheet configuration upserts retain the existing configuration ID on reselection. Correction snapshots are keyed only by user and lack proposal and sheet identity, creating another stale-state risk.
- `ColumnMappingCorrectionState.applyCorrection` replaces corrections by field without enforcing unique column ownership. Its materialized mapping can contain currency and payment method at the same index.
- Rejection clears Redis corrections but retains the current FSM payload. Later correction and confirmation can therefore operate on a different mapping from the one still present in the conversation.
- Confirmation upserts correction deltas and then confirms every stored mapping. The database unique index on `(spreadsheet_id, column_index)` rejects collisions, but the flow lacks an earlier recoverable validation response.
- The parser pattern `(?:columna|column|col)\s*([a-z0-9]+)` matches `columa` as `col` plus `uma`. This extraction was reproduced directly. Column-first phrasing has no matching rule.
- Existing tests cover single-field updates, accumulation, rejection, and persistence failure, but the inspected cases do not establish the reported multi-turn consistency invariant or real database collision recovery.

These findings are based on source inspection and task-directed graph verification. The checked paths had no recorded coverage gaps at graph generation `2026-10-03T07:03:39Z`. No production records were inspected: a historical currency row is an explanation supported by the code, not a confirmed observation of the user's database. Application tests were not run during planning.

### Relevant implementation

- [InferColumnMapping](../../../src/application/use-cases/spreadsheet/InferColumnMapping.ts): proposal generation, inference merging, and initial persistence.
- [CorrectColumnMapping](../../../src/application/use-cases/spreadsheet/CorrectColumnMapping.ts): correction state restoration, column validation, rejection, and presentation.
- [ConfirmColumnMapping](../../../src/application/use-cases/spreadsheet/ConfirmColumnMapping.ts): final persistence and transition to category detection.
- [ColumnMappingCorrectionState](../../../src/domain/value-objects/ColumnMappingCorrectionState.ts): immutable correction accumulation and materialization.
- [ColumnMappingCorrectionParser](../../../src/application/services/ColumnMappingCorrectionParser.ts): deterministic field and column extraction.
- [Repository ports](../../../src/domain/ports/repositories.ts): mapping persistence and correction snapshot contracts.
- [DrizzleColumnMappingRepository](../../../src/infrastructure/db/repositories/DrizzleColumnMappingRepository.ts): mapping upserts and confirmation.
- [DrizzleSpreadsheetConfigRepository](../../../src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.ts) and [HandleSheetSelection](../../../src/application/use-cases/spreadsheet/HandleSheetSelection.ts): configuration identity across reselection.
- [RedisMappingCorrectionStateRepository](../../../src/infrastructure/redis/RedisMappingCorrectionStateRepository.ts): snapshot serialization and expiry.
- [Database schema](../../../src/infrastructure/db/schema/index.ts): existing field and column uniqueness constraints.
- [Message worker](../../../src/interfaces/workers/message.worker.ts): confirmation dispatch, correction resumption, and category entry.
- [Onboarding copies](../../../src/application/copies/onboarding.copies.ts): proposal, correction, rejection, and recovery messages.

### Required conventions and documentation

- [AGENTS.md](../../../AGENTS.md).
- [Plan conventions](../../../docs/plans/plan-conventions.md).
- [ADRs](../../../docs/adr/adr.md), particularly persisted conversational state, spreadsheet ports, centralized copy, and deterministic next-step execution.
- [Inference feature](../../../docs/features/infer-and-propose-column-mapping.md).
- [Confirmation and correction feature](../../../docs/features/confirm-or-correct-column-mapping.md).
- [Data model](../../../docs/architecture/data-model.md).
- [Testing guidelines](../../../docs/testing/guidelines.md).
- [Feature index](../../../docs/features/README.md), updated whenever the corresponding feature documents change.

## Phases

### Phase 1: Make the complete mapping flow consistent and recoverable

Description: Deliver a working end-to-end fix for the original correction and confirmation flow, including existing stale state. A user can assign payment method to A, continue after rejection or cache expiry, and confirm the exact proposal displayed.

#### Public contracts and behavior

Add the following repository operation and wire its implementation through existing repository consumers and test fixtures:

```ts
replaceBySpreadsheetId(
  spreadsheetId: string,
  mappings: Omit<ColumnMapping, 'id' | 'spreadsheetId'>[],
): Promise<void>;
```

The operation validates unique fields and columns and atomically replaces the mapping set for the specified spreadsheet. It removes obsolete assignments, supports valid column exchanges without intermediate uniqueness violations, and rolls back the entire replacement on failure. It must not affect another spreadsheet. Confirmation supplies the full validated mapping with confirmation timestamps so replacement and confirmation do not leave a partially finalized database set.

Extend the mapping proposal payload and `MappingCorrectionStateSnapshot` with a shared proposal identity and spreadsheet context: `proposalId`, `spreadsheetId`, `provider`, `fileId`, and `sheetName`. Keep the detected `headerRowIndex` available throughout correction and confirmation. Persist enough mapping metadata to preserve inferred versus manually assigned fields when reconstructing after Redis expiry. Validate serialized snapshots at the boundary; legacy or mismatched snapshots are not authoritative.

The active persisted conversational proposal is the source for the mapping being reviewed. Redis is a compatible cache of that proposal's corrections, not a source that may silently override it. If the active proposal cannot be validated, show a recovered or regenerated proposal and require a new confirmation; do not confirm an unseen database fallback.

An explicit assignment gives the selected field exclusive ownership of the target column. Any other field at that column becomes unassigned. Repeating the same assignment is idempotent. The displaced field must not reappear when later corrections are replayed, Redis expires, or the user rejects the proposal. Recalculate `unmappedFields` from the complete supported field set and effective mapping.

`no` preserves the current valid assignments and opens manual correction guidance. It does not clear the only copy of accumulated changes. Invalid mappings remain in `ONBOARDING_MAPPING`; category detection only starts after successful validated confirmation.

User-facing copy remains in Spanish in the centralized copy module. Add explicit reassignment feedback such as `La columna A queda para Medio de pago. Moneda queda sin asignar.` Use `(vacía)` consistently for empty headers. Recovery copy must explain when the proposal needs review again; conflict copy must identify affected columns and fields rather than emit the generic save error.

#### To-do actions

- [x] Add regression fixtures for the exact A-L header layout and a stale currency mapping at A. Exercise inference, real correction logic, rejection, repeated assignment, confirmation, and worker category dispatch as a sequence, mocking only external boundaries.
- [x] Implement `replaceBySpreadsheetId` transactionally and validate the complete input before mutations. Retain existing database uniqueness protections and scope all operations to the selected spreadsheet.
- [x] Make inference replace an accepted new proposal as a complete set rather than upsert a subset. Do not persist a partial title-row/no-header result as if it were a valid proposal. Invalidate prior proposal caches when a new proposal is established.
- [x] Establish proposal identity and context in the FSM payload and correction snapshots. Reconcile legacy sessions from validated current proposal data; never silently merge in hidden database rows or corrections belonging to a different sheet or proposal.
- [x] Update the immutable correction model so explicit assignment removes competing ownership, retains unrelated fields, and supports moving a displaced field to a different column without resurrecting previous collisions.
- [x] Use the same effective mapping for the displayed proposal, conversational payload, compatible Redis snapshot, and confirmation input. Preserve header-row context and inference/manual provenance. Persist the conversational correction before sending an updated success message; recover safely from cache, transition, or delivery failures without confirming unseen state.
- [x] Change rejection to retain the effective mapping and provide correction guidance. Update worker resume behavior to calculate actual unmapped fields instead of forcing an empty list.
- [x] On Redis expiry, reconstruct from a validated active proposal. If reconstruction or identity validation fails, show a fresh review prompt and remain in the mapping state until the user confirms it.
- [x] Validate uniqueness and proposal context before confirmation. Persist and confirm the entire effective set atomically, clear only the matching transient correction state after successful persistence, and advance only on success. Repeated confirmation or recovery after a later transition failure must not restore obsolete assignments.
- [x] Add or update domain and application tests for exclusive column ownership, displacement, repeated assignment, empty headers, newly mapped fields, category/subcategory distinction, preserved B-F assignments, accurate unmapped fields, and valid column exchanges.
- [x] Add or update inference, correction, confirmation, Redis, and worker tests for stale currency rows, legacy snapshots, mismatched proposals, file/sheet reselection, `no` followed by correction or confirmation, Redis expiry before correction/confirmation/resume, invalid active payloads, and failure recovery. Assert no success confirmation or category transition on validation or persistence failure.
- [x] Add real PostgreSQL integration tests for complete replacement, obsolete-row removal, valid column exchanges, duplicate-input rejection, spreadsheet isolation, persisted confirmation timestamps, and rollback. Extend existing repository unit coverage without relying on mocked database calls to prove constraint behavior.
- [x] Update the inference and confirmation/correction feature documents and their README index to describe implemented behavior and current contracts. Correct obsolete rejection/re-inference and expiry descriptions. Record any architectural decision needed for authoritative proposal state in an ADR and update its README index if added.
- [x] Run `pnpm test` and the relevant PostgreSQL integration suite using the repository's test setup. Fix failures and verify the reported conversation ends with only payment method in A and currency unassigned.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Recognize the reported correction phrases reliably

Description: Complete the conversational repair by accepting the user's column-first phrasing and the specific `columa` typo, while preventing partial-word column extraction and preserving the one-field-per-message rule.

#### Public contracts and behavior

Preserve the existing parser signature and result union:

```ts
parse(message: string): CorrectionParseResult;

type CorrectionParseResult =
  | { kind: 'success'; field: GasttoField; columnRef: string }
  | { kind: 'failure'; reason: string };
```

Accept these messages as `medio_pago` with column reference `A`:

- `medio de pago columna A`
- `A medio de pago`
- `medio de pago es la columna A`
- `Intentaste guardar dos elementos en la columa A, solo es medio de pago`

Recognize `columa` as a bounded, explicit supported typo. Match whole column markers, not prefixes inside words. Continue supporting letter, numeric, and quoted-header references. Reject messages with multiple fields or conflicting column references without applying partial changes; request a single unambiguous assignment. Keep parse failures distinct from well-formed references to columns absent from the sheet.

#### To-do actions

- [ ] Add table-driven parser regression cases for all four reported phrases, including the exact sentence previously producing `UMA`.
- [ ] Add whole-token boundaries to column-marker matching and explicit handling of `columa`. Add an anchored column-first assignment form that cannot interpret arbitrary leading prose as a column.
- [ ] Validate ambiguous references before returning success. Preserve supported ES/EN field synonyms, optional subcategory recognition, numeric references, multi-letter explicit columns, and quoted header names; do not let the new rules capture unrelated words or prepositions.
- [ ] Add negative tests for column-marker substrings, unrelated prose, missing references, several fields, and conflicting references. Retain explicit invalid-column feedback when a syntactically valid column does not exist.
- [ ] Exercise the four phrases through `CorrectColumnMapping` with the real parser and correction model. Verify each produces the phase 1 invariant, repeated variants remain idempotent, and confirmation still saves only payment method at A.
- [ ] Update centralized correction guidance with a supported concise example, and update the confirmation/correction feature document and its README index with accepted formats and ambiguity behavior.
- [ ] Run `pnpm test`, including phase 1 regression coverage, and fix any failures.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Execute Phase 2 to recognize the reported correction phrases reliably after the user reviews or accepts the Phase 1 changes.

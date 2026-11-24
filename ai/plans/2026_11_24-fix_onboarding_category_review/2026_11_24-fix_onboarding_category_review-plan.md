# Fix onboarding category review

## Goal

Ensure onboarding presents the current category/subcategory proposal before accepting it and preserves the confirmed destination and column mappings through payment review. Recover interrupted or inconsistent setup with actionable instructions, including onboarding after account deletion and registration again.

## Context

- Approved scope: two implementation phases, on the existing `feat/add-category-during-expense-correction` branch. This document does not authorize implementation or a commit.
- Reported conversation: the user confirmed payment column A, category column C, and subcategory column D. Gastto announced category review but sent only a generic setup placeholder. The user replied `ok` to unblock the conversation, then received an empty payment proposal claiming there was no mapped payment column. This reply was not an informed approval of an unseen category list.
- Verified code behavior: `DetectCategories` calls `sendPlaceholder` when configuration or category mapping is absent. That path stores default categories without children while displaying no category proposal. The worker can subsequently interpret `ok` as confirmation and advance to payment review.
- Unresolved cause: why the detection/payment steps did not find the mappings shown immediately beforehand. Reproduce and trace persistence and configuration identity before attributing this to deletion, caching, concurrency, or a particular repository defect.
- Existing targeted validation: 40 tests across detection, mapping confirmation, category confirmation, and payment detection passed during analysis. This does not establish coverage of the complete reported sequence.

### Implementation references

- [Repository instructions](../../../AGENTS.md).
- [Plan conventions](../../../docs/plans/plan-conventions.md).
- [Architecture decisions](../../../docs/adr/adr.md), especially persisted FSM, adapter boundaries, and deterministic onboarding transitions.
- [Re-onboarding configuration decision](../../../docs/adr/ADR-015-upsert-spreadsheet-config-on-reonboarding.md). Use current source as authoritative where the historical ADR differs.
- [Data model](../../../docs/architecture/data-model.md).
- [Category confirmation](../../../docs/features/category-confirmation.md).
- [Subcategory hierarchy](../../../docs/features/subcategory-hierarchy.md).
- [Mapping confirmation](../../../docs/features/confirm-or-correct-column-mapping.md).
- [Payment methods](../../../docs/features/payment-methods.md).
- [Account deletion](../../../docs/features/account-deletion.md).
- [Conversation state management](../../../docs/features/conversation-state-management.md).
- [Testing guidelines](../../../docs/testing/guidelines.md).
- [Mapping confirmation use case](../../../src/application/use-cases/spreadsheet/ConfirmColumnMapping.ts) and [active proposal validation](../../../src/application/services/ActiveColumnMappingProposal.ts).
- [Category detection](../../../src/application/use-cases/spreadsheet/DetectCategories.ts), [category confirmation](../../../src/application/use-cases/spreadsheet/ConfirmCategories.ts), and [payment detection](../../../src/application/use-cases/spreadsheet/DetectPaymentMethods.ts).
- [Category payload](../../../src/application/dtos/CategoryOnboardingState.ts), [state transitions](../../../src/application/use-cases/conversation/TransitionConversationState.ts), and [messaging delivery result](../../../src/application/ports/output/messaging.port.ts).
- [Message worker](../../../src/interfaces/workers/message.worker.ts) and [worker tests](../../../src/interfaces/workers/message.worker.spec.ts).
- [Mapping repository](../../../src/infrastructure/db/repositories/DrizzleColumnMappingRepository.ts) and [configuration repository](../../../src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.ts).
- [Hierarchy persistence tests](../../../src/__tests__/integration/subcategory-onboarding-persistence.integration.spec.ts) and [account deletion integration tests](../../../tests/integration/account-deletion-flow.integration.spec.ts).

### Constraints and risks

- Retain existing flat-category and linked-hierarchy behavior, including optional subcategories, orphan warnings, header-row handling, manual edits, and final atomic catalog activation.
- An actually unmapped payment column remains valid for local payment storage. A missing or mismatched mapping that was just confirmed must instead trigger recovery.
- Defaults are valid after a successful category read with no usable categories. Missing setup prerequisites must not be converted into a confirmable default proposal.
- Apply existing revision/CAS and expiry rules to recovery and presentation updates. Stale execution must not overwrite a newer proposal or enable confirmation.
- Messaging can return `status: 'failure'` without throwing. A successful await alone is insufficient evidence that a proposal was presented. Delivery success means adapter-reported success, not proof that a person read the message.
- Legacy drafts need safe re-presentation. Do not infer presentation from the mere presence of category names, and do not discard reviewed vocabulary unnecessarily.
- Use structured injected Pino logs for setup inconsistencies without recording credentials, spreadsheet contents, or complete conversational payloads.
- Integration tests must use disposable PostgreSQL/Redis and mocked external providers. Do not read local secret files or access production data. Report container/runtime limitations explicitly.

## Phases

### Phase 1: Preserve mapping context and recover inconsistent onboarding

Deliver a working mapping-to-category transition that either presents the detected vocabulary or tells the user how to recover. Diagnose and fix demonstrated mapping inconsistency rather than merely hiding it behind a different message.

#### Contracts

- Extend `ConfirmColumnMappingOutput.payload` with the confirmed `spreadsheetId` and `proposalId`, retaining provider, file, sheet, and valid header-row context.
- Extend category onboarding metadata with the confirmed context needed to validate downstream reads against the current configuration. Retain the reviewed mapping identity or normalized mapping snapshot needed to distinguish intentional absence from unexpected loss of a confirmed field.
- Change `DetectCategoriesOutput` to a discriminated result separating a usable proposal from required recovery. Recovery results must not expose a synthetic confirmable category state. Update worker consumers and typed mocks together.
- Keep `DetectCategories.execute(input)` and `ConfirmCategories.execute(input)` as application entry points, validating configuration ownership, active destination, and confirmed mapping context before detection or advancement.
- Replace the generic missing-prerequisite placeholder with specific Spanish recovery copy identifying the required action and cancellation option. Reuse legal FSM transitions; if a recovery route would require a new transition, specify and test that transition explicitly.
- Update colocated use-case tests, worker routing tests, and real-repository integration cases for context preservation and recovery.

#### To-do actions

- [x] Reproduce the reported A/C/D mapping and trace `config.id`, proposal identity, confirmed rows, and subsequent reads using real configuration/mapping repositories and mocked Sheets/messaging boundaries. Compare fresh registration, repeated setup, and setup after account erasure/re-registration; record which trigger is reproduced and which remains unproven.
- [x] Add regression assertions that fail for the verified placeholder/default behavior. Keep the reproduction and its fix in this phase so the phase finishes green.
- [x] Preserve confirmed context from column confirmation through category detection, category edits, and payment review. Check retrieved mappings against that context; never replace missing mappings with assumptions copied from the visible message alone.
- [x] Fix the mapping persistence or selection defect established by reproduction. If the original disappearance cannot be reproduced, document that limitation and add contextual diagnostics plus deterministic protection against the inconsistent reads.
- [x] Replace `sendPlaceholder` for missing configuration/category mapping with typed recovery. Missing configuration follows the established reconnection/setup path; missing or changed mappings require mapping review. Do not advance to payments or activate the user during recovery.
- [x] Keep the successful empty-read path: visibly propose default categories and wait for confirmation. For a valid linked mapping, read and display category/subcategory relationships from the same rows.
- [x] Preserve payment column A through payment detection. Keep local-only editing for deliberately unmapped payment columns, while detecting unexpected loss or destination mismatch before claiming that the column is unmapped.
- [x] Add tests for missing config, missing category mapping, missing previously confirmed payment mapping, stale/wrong configuration or proposal, empty valid reads, header offsets, category-only sheets, and linked C/D hierarchy. Assert that recovery cannot create an unseen confirmable list or send activation success.
- [x] Update the affected feature documentation and `docs/features/README.md` with implemented context and recovery behavior. Update the data-model documentation if persisted payload contracts change; record an ADR and update its index only if the chosen fix introduces a new architectural decision.
- [x] Run relevant use-case, worker, and real-repository tests. Run `pnpm test` and report failures or unavailable integration prerequisites accurately.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Require proposal presentation and verify deletion-to-onboarding recovery

Ensure a reply cannot accept an unseen or outdated category proposal. Complete the user-visible flow after account deletion and new registration, including recovery of old interrupted drafts.

#### Contracts

- Extend the persisted `ONBOARDING_CATEGORIES` payload with a proposal identity and nullable successful-presentation evidence bound to the current category draft/context. Exact property names must follow existing project naming conventions and be documented alongside the payload parser.
- Set presentation evidence only after `MessagingOutputPort.sendMessage` returns `status: 'success'`, using the current CAS precondition. Do not change the messaging port interface.
- Invalidate category presentation evidence when the reviewed hierarchy or destination changes. Re-present an equivalent legacy draft before enabling confirmation, preserving category/child identities where available.
- Update `ConfirmCategories.execute(input)` to require matching valid context and successful category presentation before category acceptance. Re-presentation/recovery must return without advancing to payment review in the same incoming message. Preserve the existing normal confirmation aliases once the current proposal is eligible.
- Preserve category acceptance evidence through payment review while continuing to validate configuration/mapping identity. Apply the guard to every executable confirmation path, including legacy compatibility paths; the worker alone is not the enforcement boundary.
- Update proposal/edit/recovery copy and test suites for successful delivery, failed delivery, interruption, compatibility, stale proposals, and the full deletion/re-registration sequence.

#### To-do actions

- [ ] Add backward-compatible parsing/serialization for proposal and presentation metadata, distinguishing missing legacy evidence from an eligible current proposal. Retain unrelated setup metadata and stable draft IDs.
- [ ] Persist the draft as unpresented, send the visible category hierarchy, then record successful presentation against the same proposal and observed revision. Treat thrown errors and returned failure results as unsuccessful presentation. Ensure a crash or stale CAS between these operations remains recoverable.
- [ ] Apply the same presentation lifecycle after category edits. Prevent an old presentation marker from authorizing a modified draft.
- [ ] Route `ok`, `sí`, or `confirmar` against an unpresented/legacy category draft to re-presentation or prerequisite recovery, then wait for a new reply. Preserve the ordinary confirmation experience after a valid proposal is presented.
- [ ] Recover the old placeholder-generated state by checking prerequisites and re-detecting categories when its prior spreadsheet proposal cannot be trusted. Do not accidentally persist the old hidden defaults during final payment confirmation.
- [ ] Add tests for a failed send result, thrown delivery error, crash before presentation evidence, stale presentation update, modified hierarchy, interrupted draft, legacy flat/canonical payloads, cancellation, and subsequent valid confirmation. Assert no premature payment review, catalog commit, or activation.
- [ ] Add an integration regression using real PostgreSQL/Redis repositories and the supported deletion/identity lifecycle with external services mocked: configure an account, delete it, register the same messaging identity as a fresh account, confirm A/C/D mappings, show the real hierarchy, confirm categories, show mapped payment values, and atomically activate after final confirmation.
- [ ] Assert new account/configuration identity, absence of old catalogs and account-owned stale context, preservation of external sheet content during deletion, correct ordering of visible proposals, and persistence of the reviewed categories, children, payment methods, and final `IDLE` state. Test onboarding interruption/resumption without repeating the entire deletion matrix.
- [ ] Update category, subcategory, mapping, payment, and account-deletion feature docs where implemented behavior changes, plus `docs/features/README.md`. Update persisted payload documentation and any ADR/index introduced by the implementation.
- [ ] Run targeted unit/worker and PostgreSQL/Redis integration regressions, followed by `pnpm test`. Include an acceptance transcript matching the reported conversation and explain any original trigger still unproven. Do not mark unavailable integration execution as passed.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Review Phase 1, then execute Phase 2 to require successful category presentation and verify the complete deletion/re-registration lifecycle.

## Phase 1 execution evidence (2026-11-24)

- Implementation was explicitly requested through `execute-plan`; work remains on `feat/add-category-during-expense-correction`. No commit was requested or created.
- Reproduced the prerequisite defect: missing configuration or category mapping previously created a hidden default proposal. Recovery now returns no confirmable category state, transitions before sending its instructions, and never advances to payment review or activation.
- Confirmed context includes configuration/proposal identity, destination, effective header, and the full field/column/header/confirmation-timestamp snapshot. Serialization retains it across category edits and payment review. Downstream checks reject changed context or repository mappings instead of deriving mappings from visible copy.
- Disposable PostgreSQL reproduction with real configuration, mapping, conversation and vocabulary repositories retained payment A, category C and child D below header row 2 through fresh registration, repeated setup, an incomplete destination change, and fresh registration after `DrizzleAccountDeletionRepository.eraseAccount`. Configuration identity was retained for repeated setup and replaced after erasure. These cases did **not** reproduce the original mapping disappearance, so no repository persistence defect is asserted or speculative persistence rewrite applied.
- Induced mapping loss returned to mapping review before final activation. Real-repository regressions also rejected an old proposal supplied with a current execution, stale recovery against a newer revision, and expired recovery, without a success message or draft overwrite.
- This phase's erasure comparison exercises transactional storage erasure, not the complete messaging-identity, credential revocation, Redis cleanup and account-deletion service lifecycle. That lifecycle, delivery evidence, and interrupted legacy draft re-presentation remain Phase 2 work. Legacy drafts without `confirmedMappings` retain compatibility in this phase.
- Canonical category, mapping, hierarchy, payment and FSM documentation and the feature index were synchronized. Persisted JSONB metadata is documented in the data model; no schema migration or new architectural mechanism was introduced.
- Validation: 432 targeted tests passed across seven suites. Five opt-in PostgreSQL regression cases passed using a disposable container. `pnpm test` passed with 212 suites / 2,937 tests passed and 12 suites / 68 tests skipped; opt-in tests were not counted as passed by that general run. `pnpm run typecheck` passed. `pnpm run lint` passed (existing package-module warning only). Review/continuation and commit choices are presented to the user at the phase boundary; Phase 2 has not started.

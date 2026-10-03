# Expense extraction validation

## Automated evidence

The initial full test run passed 168 suites and 2303 tests; four suites containing 29 opt-in tests were skipped. It included real PostgreSQL/Redis extraction-recovery and confirmed-save integration coverage. The final full run after the model-specific adjustment and expanded timeout integration cases passed 168 suites and 2307 tests (29 skipped), including 13 PostgreSQL/Redis expense-flow integration cases. The 37 adapter-boundary tests passed again after lint-only fixture cleanup. Lint passed; TypeScript validation also covers the new required environment field in bootstrap test fixtures.

The adapter fixtures are synthetic. No production provider response was available to establish the historical reason for empty output. Do not describe successful mocks as verification of the real provider.

## User acceptance and closure: 2026-10-03

The user reported that the registration problem is resolved and expenses are being recorded. They then explicitly asked to finish the current plan before analyzing the additional findings. This is user-reported live acceptance, not an agent-observed provider run.

The plan is closed for the expense-registration failure. No deployed commit, provider/model metadata, raw response, exact live row count, or live timeout/recovery trace was supplied. The agent did not deploy or make a live provider call. Capturing telemetry and an actual failure fixture is deferred at closure; the historical cause of empty output is still unverified. Existing automated evidence covers confirmation, duplicate protection, and timeout recovery.

## Separate follow-up

The user reported that categories and subcategories are not recorded correctly, plus other unspecified findings. This is explicitly outside this plan's closure and awaits a separate analysis. No classification fix is claimed, and no investigation was started as part of this documentation update.

## Sources for model compatibility

- [NVIDIA GLM-5.3-Flash](https://docs.api.nvidia.com/nim/reference/z-ai-glm-5-3-flash): documented reasoning effort and separate final content.
- [NVIDIA inference contract](https://docs.api.nvidia.com/nim/reference/z-ai-glm-5-3-flash-infer): generation limit semantics.

The 4096-token cap is a bounded engineering choice to provide room for reasoning and final structured output. User acceptance confirms restored registration but does not establish an optimal token budget or guarantee success within 30 seconds.

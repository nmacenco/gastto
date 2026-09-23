# Expense extraction validation

## Automated evidence

The initial full test run passed 168 suites and 2303 tests; four suites containing 29 opt-in tests were skipped. It included real PostgreSQL/Redis extraction-recovery and confirmed-save integration coverage. The final full run after the model-specific adjustment and expanded timeout integration cases passed 168 suites and 2307 tests (29 skipped), including 13 PostgreSQL/Redis expense-flow integration cases. The 37 adapter-boundary tests passed again after lint-only fixture cleanup. Lint passed; TypeScript validation also covers the new required environment field in bootstrap test fixtures.

The adapter fixtures are synthetic. No production provider response was available to establish the historical reason for empty output. Do not describe successful mocks as verification of the real provider.

## Development verification still required

1. Deploy the pushed branch through the normal development workflow and record the deployed commit.
2. Send `almuerzo 200 euros` to the development Telegram bot using a designated test spreadsheet.
3. Match `llm_extraction_started` and `llm_extraction_completed` by correlation ID. Record only provider, model, duration, outcome, code, HTTP status, finish reason, and numeric usage. Do not capture user messages, raw provider bodies, API keys, or reasoning text.
4. Confirm that a valid 200 EUR review appears before any spreadsheet write. Confirm once and verify exactly one row. Do not repeat a real financial confirmation merely to probe idempotency.
5. If extraction fails, verify a dedicated recovery message and a successful resend. For `LLM_OUTPUT_TRUNCATED`, investigate the recorded termination/usage rather than interpreting reasoning as the final answer. For `LLM_TIMEOUT`, assess model/provider latency before changing the configured deadline.
6. Attach sanitized diagnostic metadata and the test result to this record, then close the three live-evidence tasks left unchecked in the plan.

## Sources for model compatibility

- [NVIDIA GLM-5.3-Flash](https://docs.api.nvidia.com/nim/reference/z-ai-glm-5-3-flash): documented reasoning effort and separate final content.
- [NVIDIA inference contract](https://docs.api.nvidia.com/nim/reference/z-ai-glm-5-3-flash-infer): generation limit semantics.

The 4096-token cap is a bounded engineering choice to provide room for reasoning and final structured output. It requires real-provider validation and does not guarantee success within 30 seconds.

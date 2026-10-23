# Integrate Groq expense extraction

## Goal

Add Groq `openai/gpt-oss-20b` as a separately keyed LLM provider for expense extraction and validate it in Fly development. The operator subsequently selected Groq as the explicit primary provider with NVIDIA as extraction fallback; automatic provider priorities were not changed.

## Context

- The bounded single-backup flow and explicit Groq adapter are merged into `develop` and deployed to `gastto-develop`.
- Two user-run direct Groq requests returned HTTP 200. One took 0.605711 seconds to first byte and 0.605832 seconds total. Representative Gastto checks and their limits are recorded in [validation.md](./validation.md).
- [ADR-002](../../../docs/adr/adr.md) defines the provider-independent LLM port. [ADR-026](../../../docs/adr/2026-09-23-bound-expense-extraction.md) bounds extraction and classifies failures. [ADR-028](../../../docs/adr/ADR-028-bound-expense-extraction-fallback.md) defines one backup within the same deadline and excludes cancellation from fallback.
- [Expense summary review](../../../docs/features/expense-summary-review.md) defines the extraction, category, review, and explicit-confirmation behavior. [Configuration](../../../docs/architecture/config-env.md) and [deployment operations](../../../docs/features/deployment.md) define runtime variables and Fly setup.
- [ExtractedExpenseSchema](../../../src/infrastructure/adapters/llm/expenseExtraction.ts), [runExtraction](../../../src/infrastructure/adapters/llm/extractionRuntime.ts), [ExtractionFallbackLLMPort](../../../src/infrastructure/adapters/llm/ExtractionFallbackLLMPort.ts), [environment schema](../../../src/config/env.schema.ts), and [createLLMPort](../../../src/bootstrap/buildDependencies.ts) are the implementation boundaries. The existing [OpenAI adapter](../../../src/infrastructure/adapters/llm/OpenAIAdapter.ts) is a transport reference; the Groq credential must remain separate from `OPENAI_API_KEY`.
- Groq documents its [quickstart](https://console.groq.com/docs/quickstart), [OpenAI-compatible base URL](https://console.groq.com/docs/openai), [JSON object mode and its schema limitations](https://console.groq.com/docs/structured-outputs), and [rate limits](https://console.groq.com/docs/rate-limits). Keep local schema validation even when the provider returns valid JSON.

## Phases

### Phase 1: Explicit Groq provider

Provide a working opt-in Groq path without changing the existing `auto` provider priorities.

- [x] Add a `GroqAdapter` implementing the existing `LLMPort` methods `extractExpense`, `interpretCorrection`, and `generateResponse`, so `LLM_PROVIDER=groq` has a complete port. Use Groq's Chat Completions endpoint with its own `GROQ_API_KEY` and configurable `GROQ_MODEL` defaulting to `openai/gpt-oss-20b`. Reuse the existing prompts, untrusted-data serialization, and extraction runtime. For extraction, request JSON object output, disable SDK retries, respect the supplied abort signal and deadline, and validate the content through `ExtractedExpenseSchema`.
- [x] Extend the environment and bootstrap contracts with optional `GROQ_API_KEY`, validated `GROQ_MODEL`, and `groq` values for `LLM_PROVIDER` and `LLM_FALLBACK_PROVIDER`. Permit explicit primary or fallback selection; require the matching key and distinct providers. Preserve the current `auto` primary and fallback ordering in this phase. Add examples to `.env.example` without a real key.
- [x] Add meaningful provider-boundary and bootstrap tests: valid expense extraction and configured category/subcategory behavior; missing key and model selection; provider `429`; timeout while awaiting headers or body; invalid JSON/schema and empty or truncated content; caller cancellation without fallback; a typed Groq failure invoking the configured alternate provider within the shared deadline; and correction/chat behavior when Groq is primary. Assert safe logs omit credentials, prompts, and response bodies.
- [x] Update `docs/architecture/config-env.md`, `docs/features/expense-summary-review.md`, and `docs/features/deployment.md` for the implemented opt-in behavior. Update `docs/features/README.md` because a feature document changes. State that Fly and broader live quality validation remain pending.
- [x] Run the relevant Vitest suites and `pnpm test`; fix failures. `pnpm` itself failed before scripts with an environment database error, so the equivalent local Vitest binary was run successfully.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any. `pnpm` itself failed before scripts; the equivalent local ESLint and TypeScript binaries passed.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Explicit Groq primary and development validation

- [x] Deploy the Groq adapter to `gastto-develop` and configure `LLM_PROVIDER=groq` with `LLM_FALLBACK_PROVIDER=nvidia`; leave production unchanged.
- [x] Correct the day-first numeric date failure found through Telegram and deploy the regression fix through PR #69.
- [x] Review three distinct expense types through Telegram with the operator and repeat the previously failing date case.
- [x] Confirm one reviewed expense and verify exactly one spreadsheet row with the expected date and payment method.
- [x] Pass local and PR quality gates, then record the evidence and limits in [validation.md](./validation.md).

The original proposal to promote Groq into `LLM_FALLBACK_PROVIDER=auto` was superseded by the explicit-primary decision. No automatic priority change or production rollout was made. Live fault injection, fallback activation, and Gastto-level latency measurement were outside the operator's functional acceptance checks.

## Next step

Development functional validation is closed. Treat automatic priority changes, live fallback resilience, and production promotion as separate decisions with their own evidence.

# Integrate Groq expense extraction

## Goal

Add Groq `openai/gpt-oss-20b` as a separately keyed LLM provider for expense extraction. Validate its behavior from the Fly development Machine before making it an automatic fallback choice.

## Context

- The local branch `fix/expense-extraction-fallback` contains the bounded, single-backup extraction flow from commit `90b1fc5`. It has not been deployed.
- Two user-run direct Groq requests returned HTTP 200. The Transport example took 0.605711 seconds to first byte and 0.605832 seconds total. These results do not establish the Fly network path or quality across the application's expense cases.
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

### Phase 2: Fly validation and automatic fallback

Promote Groq to the automatic backup choice only after end-to-end evidence supports it.

- [ ] Deploy the Phase 1 code to `gastto-develop` through the approved development workflow and set `GROQ_API_KEY` as a Fly secret without putting its value in a command, file, log, or transcript. Configure `LLM_FALLBACK_PROVIDER=groq` explicitly. Do not change production settings in this phase.
- [ ] From the development Fly Machine, run representative Alimentación, Transporte, and at least one different or ambiguous expense through Groq, including configured categories and enabled/disabled subcategories. Record HTTP status, first-byte and total latency, JSON/schema validity, and field accuracy without storing full sensitive responses. Exercise the Gastto flow through review and explicit confirmation, and check that failed extraction cannot write an expense. Treat Fly connectivity, repeated `429`, invalid output, or material field errors as a hold; record the reason before changing automatic selection.
- [ ] If validation passes, change only `LLM_FALLBACK_PROVIDER=auto` to prefer Groq when its own key is configured and the primary is different. Preserve `LLM_PROVIDER=auto` primary precedence and the single-backup, shared-deadline contract. Keep explicit provider selection and `none` behavior. Test auto precedence for all relevant key combinations, failure to fallback, timeout budget, cancellation, and absence of double writes.
- [ ] Record the acceptance evidence and the auto-priority decision in a new ADR using `docs/adr/template.md`, then update `docs/adr/README.md`. Update the implemented behavior and Fly configuration guidance in `docs/features/expense-summary-review.md`, `docs/features/deployment.md`, `docs/features/README.md`, and `docs/architecture/config-env.md`. Include the development rollback setting (`LLM_FALLBACK_PROVIDER=none` or the former explicit provider).
- [ ] Run the relevant Vitest suites and `pnpm test`; fix failures.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Validate Groq from the Fly development Machine in Phase 2, then enable automatic fallback only if the evidence passes.

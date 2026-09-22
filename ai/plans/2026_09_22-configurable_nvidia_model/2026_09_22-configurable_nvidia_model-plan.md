# Configurable NVIDIA LLM Model

## Goal

Make the NVIDIA extraction model configurable through `NVIDIA_MODEL`, with
`z-ai/glm-5.3-flash` as the default replacement for the retired MiniMax model.
Preserve the existing NVIDIA API key, endpoint, request contract, and provider
selection behavior while allowing future model rotations without source changes.

## Context

The current NVIDIA adapter hardcodes the retired `minimaxai/minimax-m3` model,
which causes production requests to fail with HTTP 410 even though the NVIDIA
API connection remains valid. The replacement model uses the same
OpenAI-compatible NVIDIA Chat Completions endpoint.

Relevant implementation and documentation:

- [`src/infrastructure/adapters/llm/NvidiaAdapter.ts`](../../src/infrastructure/adapters/llm/NvidiaAdapter.ts): NVIDIA API adapter and model request payload.
- [`src/infrastructure/adapters/llm/NvidiaAdapter.spec.ts`](../../src/infrastructure/adapters/llm/NvidiaAdapter.spec.ts): adapter contract tests and request assertions.
- [`src/config/env.schema.ts`](../../src/config/env.schema.ts): runtime environment validation and defaults.
- [`src/bootstrap/buildDependencies.ts`](../../src/bootstrap/buildDependencies.ts): provider selection and adapter composition.
- [`src/bootstrap/buildDependencies.spec.ts`](../../src/bootstrap/buildDependencies.spec.ts): dependency composition tests.
- [`.env.example`](../../.env.example): local configuration template.
- [`docs/architecture/config-env.md`](../../docs/architecture/config-env.md): canonical environment-variable documentation.
- [`docs/adr/adr.md`](../../docs/adr/adr.md): ADR-002 provider adapter and LLM portability decisions.
- [`docs/plans/plan-conventions.md`](../../docs/plans/plan-conventions.md): plan structure and execution conventions.

No database schema or migration is required. The NVIDIA API key, endpoint,
request format, prompts, response parsing, and provider precedence remain
unchanged.

## Phases

### Phase 1: Add configurable model selection

Description: Introduce the `NVIDIA_MODEL` configuration contract, wire it
through bootstrap into `NvidiaAdapter`, and switch the default model to
`z-ai/glm-5.3-flash`. Keep direct adapter construction backwards-compatible by
providing the same default when no model argument is supplied.

Public contracts:

- Add the optional `NVIDIA_MODEL` environment variable with a validated model-ID
  format and default `z-ai/glm-5.3-flash`.
- Extend the `NvidiaAdapter` constructor with an optional model argument while
  preserving `new NvidiaAdapter(apiKey)` behavior.
- Keep the existing `LLMPort` interface unchanged.

To-do:

- [x] Add `NVIDIA_MODEL` to `src/config/env.schema.ts` with a bounded model-ID validation rule and the new default.
- [x] Add `NVIDIA_MODEL=z-ai/glm-5.3-flash` to `.env.example`.
- [x] Pass `env.NVIDIA_MODEL` from `buildDependencies` to `NvidiaAdapter`.
- [x] Replace the adapter's hardcoded model with the injected value and retain the default fallback.
- [x] Update `NvidiaAdapter.spec.ts` to assert the new default model and explicit model injection across extraction and correction requests.
- [x] Update `buildDependencies.spec.ts` and environment-schema tests for default, custom, and invalid model values.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Document and verify deployment configuration

Description: Document the operational model override, verify the full request
path with the replacement model, and provide a safe deployment checklist for
Fly.io without exposing credentials or changing the NVIDIA connection.

Public contracts:

- Document `NVIDIA_MODEL` as a server-side runtime setting in the canonical
  configuration documentation.
- Document that changing the model does not change `NVIDIA_API_KEY` or the
  NVIDIA OpenAI-compatible endpoint.

To-do:

- [x] Document `NVIDIA_MODEL`, its default, valid format, and provider-specific scope in `docs/architecture/config-env.md`.
- [x] Add deployment guidance for setting `NVIDIA_MODEL` independently on `gastto` and `gastto-develop` without logging or committing credentials.
- [x] Verify all NVIDIA request methods use the configured model and preserve the existing endpoint, headers, prompts, parsing, temperature, token, and streaming settings.
- [x] Run focused NVIDIA adapter and bootstrap tests, followed by `pnpm test`.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All planned phases are complete. Export this conversation alongside the plan for project traceability.

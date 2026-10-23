# Plan: Deterministic amount and currency extraction

## Goal

Introduce deterministic amount and currency extraction value objects and an application service that acts as a fallback when the LLM does not detect those fields, keeping the existing LLM-based extraction as the primary path.

## Context

- `src/application/use-cases/expense/RegisterExpense.ts` currently relies on `LLMPort.extractExpense()` for amount and currency detection and already implements the clarification flow.
- `src/domain/entities/User.ts` already defines `type Currency = 'ARS' | 'EUR' | 'USD' | 'MXN' | 'GBP' | 'BRL'`.
- `src/application/copies/expense.copies.ts` already contains clarification messages.
- Tests are co-located with source files as `.spec.ts`.
- The project uses Vitest, TypeScript, Fastify, and Clean Architecture.

## Architectural decision

The deterministic extractor will be a **fallback** application service. It runs only when the LLM returns `null` for amount or currency. This preserves ADR-002 (LLM as primary NLP engine), reduces LLM API usage for simple cases, and provides a testable safety net. Wiring it into `RegisterExpenseUseCase` is out of scope for tasks 1-3 and will be handled in task 6.

## Public contracts

- `Money` value object: immutable, validates non-negative amount, wraps a `Currency` code.
- `Currency` value object class: validates and normalizes ISO codes and symbols; exposes `.code` of type `Currency` (existing type alias).
- `AmountCurrencyExtractionResult` discriminated union: success with `Money`, or failures (`AmountNotFound`, `CurrencyNotFound`, `AmbiguousCurrency`, `InvalidAmountFormat`).
- `ExtractAmountCurrency` service: `execute(text: string, defaultCurrency: Currency | null) => AmountCurrencyExtractionResult`.

## Phases

### Phase 1: Create Money and Currency value objects

- [x] Create `src/domain/value-objects/Currency.ts` value object class.
- [x] Create `src/domain/value-objects/Money.ts` value object class.
- [x] Update `src/domain/value-objects/index.ts` barrel.
- [x] Add `Currency.spec.ts` and `Money.spec.ts` co-located tests.
- [x] Run `pnpm run lint` and `pnpm run typecheck`.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Define extraction result and failure types

- [x] Create `src/domain/value-objects/AmountCurrencyExtractionResult.ts` with discriminated union.
- [x] Update `src/domain/value-objects/index.ts` barrel.
- [x] Add `AmountCurrencyExtractionResult.spec.ts` tests.
- [x] Run `pnpm run lint` and `pnpm run typecheck`.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Implement deterministic extraction service

- [x] Create `src/application/services/ExtractAmountCurrency.ts`.
- [x] Implement regex/heuristic extraction for symbols ($, €, £), ISO codes (EUR, USD, ARS), thousands/decimal separators, and ambiguous symbol handling.
- [x] Use `defaultCurrency` to resolve ambiguous symbols (e.g., `$`).
- [x] Return appropriate failure types when fields cannot be determined.
- [x] Add `ExtractAmountCurrency.spec.ts` tests covering all acceptance scenarios.
- [x] Run `pnpm run lint` and `pnpm run typecheck`.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases in this plan are complete. The next step is to wire `ExtractAmountCurrency` into `RegisterExpenseUseCase` as a fallback when the LLM returns `null` for amount or currency (task 6, out of scope for this plan).

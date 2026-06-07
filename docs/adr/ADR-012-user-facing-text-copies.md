# ADR-012: Centralize User-Facing Text in Application Copy Modules

**Date**: 2026-06-03
**Status**: Accepted
**Deciders**: Architecture Team

## Context

Every user interaction in Gastto happens through messaging channels (Telegram, WhatsApp). This means there is no traditional UI layer; instead, all user-facing text — prompts, confirmations, errors, onboarding messages — lives in the code that sends messages back to the user.

Without a convention, this text tends to be inlined in Infrastructure adapters (Telegram/WhatsApp-specific code), duplicated across use cases, or scattered in ways that make it hard to review, test, and keep consistent in tone. Changes to a single message require hunting across multiple files, and there is no single place to enforce tone guidelines or prepare for future i18n.

## Considered Options

1. **Inline text in Infrastructure adapters**
   - Pros: Immediate, no indirection.
   - Cons: Violates Clean Architecture (Infrastructure should not own user-facing language). Text becomes untestable in isolation. Duplication across Telegram vs. WhatsApp adapters. Tone and terminology drift over time.

2. **Inline text inside use case classes**
   - Pros: Text lives near the business logic that triggers it.
   - Cons: Use cases become harder to read. Text changes require editing business logic files. Still no central place to review or test all messages.

3. **Centralize in Application-layer copy modules**
   - Pros: All user-facing text in one discoverable location. Easy to unit-test in isolation. Changes are explicit and reviewable. Infrastructure adapters stay pure (only send, never compose). Prepares the ground for future i18n.
   - Cons: Requires discipline to maintain domain-split modules (e.g. `onboarding`, `expense`, `shared`) so files do not grow into a single monolithic blob.

## Decision

Adopt **Option 3**: all user-facing text is defined in plain functions inside `src/application/copies/{domain}.copies.ts` modules, consumed by use cases and workers, and never inlined in Infrastructure adapters.

## Rationale

- **Clean Architecture boundary**: The Application layer owns the "what to say"; Infrastructure only owns the "how to send it."
- **Testability**: Copy functions are pure and synchronous, making them trivial to unit-test without mocks.
- **Reviewability**: A copy change is a public contract change (per `docs/plans/plan-conventions.md`). A single diff shows the exact new text.
- **Consistency**: Central location makes it easy to enforce the tone rules defined in `docs/architecture/error-taxonomy.md`.
- **i18n readiness**: If multi-language support is needed later, the copy layer is the only surface to replace.

## Consequences

### Positive

- Single source of truth for every message the user sees.
- Use cases remain focused on orchestration, not string concatenation.
- Infrastructure adapters (Telegram, WhatsApp) contain zero user-facing text.
- Copy modules can be linted and tested independently of external services.

### Negative

- Team discipline required to split copy modules by domain (`onboarding`, `expense`, `shared`) to prevent a single massive file.
- Adding a new message requires creating or editing a copy file before wiring it into a use case — a small extra step.

## Conventions Derived from This Decision

- Copy module naming: `{domain}.copies.ts` (e.g. `onboarding.copies.ts`, `expense.copies.ts`).
- Export name: `{domain}Copies` (e.g. `onboardingCopies`, `expenseCopies`).
- Functions are plain, synchronous, and return `string`. Dynamic values are passed as typed parameters.
- No copy function should perform side effects (no API calls, no randomness, no external state).
- Any change to copy text is treated as a **public contract change** and must be reflected in feature documentation and tests.

## References

- [`src/application/copies/onboarding.copies.ts`](../../src/application/copies/onboarding.copies.ts)
- [`src/application/copies/expense.copies.ts`](../../src/application/copies/expense.copies.ts)
- [`src/application/copies/shared.copies.ts`](../../src/application/copies/shared.copies.ts)
- [`docs/architecture/error-taxonomy.md`](../architecture/error-taxonomy.md)
- [`docs/plans/plan-conventions.md`](../plans/plan-conventions.md)

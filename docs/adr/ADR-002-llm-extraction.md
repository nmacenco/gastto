# ADR-002: Use LLM with Structured Extraction via Abstracted Port

**Date**: 2025-04
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

The system must interpret free-text messages in natural language (Spanish with regional variants, abbreviations, and typos) and extract precise financial entities: amount, currency, category, date, and payment method. Precision in this extraction is critical for user trust.

Additionally, the project has an explicit pedagogical objective (Master's in AI), making LLM usage a requirement, not merely a technical option.

The team also requires that the system not be tied to a single LLM provider, preserving the ability to swap or combine models without modifying application logic.

## Considered Options

1. **Classical NER (spaCy, Duckling)**
   - Pros: No external API dependency, predictable costs.
   - Cons: Requires per-language and per-region model training and maintenance. Low adaptability to user-specific financial jargon. Not aligned with the pedagogical objective.

2. **Regular expressions**
   - Pros: Zero cost, no external dependency.
   - Cons: Does not capture linguistic variety or typos. Requires constant pattern maintenance.

3. **Rasa / conversational frameworks**
   - Pros: Open source, intent-based classification.
   - Cons: High learning curve, requires training data, and provides no advantage over a well-prompted LLM for this use case.

4. **LLM provider SDK directly in application layer**
   - Pros: Fastest to implement.
   - Cons: Couples business logic to a specific vendor. Changing providers would require modifying use cases, violating the dependency inversion principle established in ADR-004.

5. **LLM with Adapter Pattern via domain port**
   - Pros: Decouples provider from business logic, enables provider swapping, aligned with pedagogical goal.
   - Cons: API token costs, variable latency.

## Decision

Use an **LLM** as the sole natural language interpretation engine, with **structured extraction via prompt engineering** (Function Calling / JSON Schema).

To decouple the concrete provider from application logic, implement the **Adapter Pattern** via an `LLMPort` in the Domain layer. Each LLM provider has its own adapter in the Infrastructure layer implementing this common interface.

**`gpt-4o`** is the default MVP implementation via `OpenAIAdapter`. New providers (Claude, Gemini, etc.) can be added in the future by implementing the same port without modifying any use case.

**Domain port `LLMPort`:**

```typescript
// Domain layer — src/domain/ports/LLMPort.ts

interface ExtractedExpense {
  monto: number | null;
  moneda: 'ARS' | 'EUR' | 'USD' | 'MXN' | 'GBP' | 'BRL' | null;
  categoria_raw: string | null;
  fecha_raw: string | null;
  medio_pago: string | null;
  confianza_categoria: 'alta' | 'baja' | 'nula';
}

interface LLMPort {
  extractExpense(userMessage: string, userContext: UserContext): Promise<ExtractedExpense>;
  generateResponse(prompt: string, context: ConversationContext): Promise<string>;
}
```

## Rationale

- Robustness against linguistic variety without additional training.
- Updatable without code changes: modifying the system prompt within the adapter adjusts extractor behavior.
- Generates natural language responses in the same step as entity extraction.
- Direct alignment with the Master's in AI pedagogical objective.
- The `LLMPort` enables swapping or combining providers without modifying any use case or the FSM, consistent with the pattern established in ADR-004.

## Consequences

### Positive

- Robustness against linguistic variety without training ("Pagué 15 lucas del almuerzo" interpreted correctly).
- Updatable without code changes via system prompt modification.
- Generates natural language responses alongside entity extraction.
- Direct alignment with the Master's in AI pedagogical objective.
- `LLMPort` enables provider interchange without use case modification.

### Negative

- API token costs. At high volume, cost can be significant. Mitigation: cache responses for identical messages from the same user.
- Variable latency (2-5 seconds typical), mitigated by the asynchronous architecture in ADR-005.
- Dependency on an external API provider: an LLM service outage halts NLP processing. Future mitigation: implement a second adapter as fallback.
- Different providers behave differently with the same prompt. The adapter cannot fully hide quality differences: switching providers requires validating the prompt and output schema against the new model before production activation.

## References

- [`docs/adr/ADR-004-spreadsheet-adapter.md`](./ADR-004-spreadsheet-adapter.md)
- [`src/domain/ports/LLMPort.ts`](../../src/domain/ports/LLMPort.ts)

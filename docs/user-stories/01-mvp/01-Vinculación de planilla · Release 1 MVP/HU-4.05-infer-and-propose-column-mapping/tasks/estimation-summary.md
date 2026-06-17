# Estimation Summary — HU-4.05 Infer and Propose Column Mapping

## Total Hours

**19 hours**

## Hours per Task

| Task ID    | Title                                              | Layer          | Hours |
|------------|----------------------------------------------------|----------------|-------|
| T-4.05-01  | Define column inference domain types and port      | Domain         | 2     |
| T-4.05-02  | Implement column header inference engine           | Infrastructure | 5     |
| T-4.05-03  | Implement Drizzle column mapping repository        | Infrastructure | 2     |
| T-4.05-04  | Persist spreadsheet preview in ONBOARDING_MAPPING  | Application    | 1     |
| T-4.05-05  | Implement InferColumnMapping use case              | Application    | 4     |
| T-4.05-06  | Wire ONBOARDING_MAPPING in message worker          | Interfaces     | 2     |
| T-4.05-07  | Feature doc and remaining tests                    | Cross-cutting  | 3     |
| **Total**  |                                                    |                | **19**|

## Coherence Check with Story Points

- **Story Points:** 5
- **Expected range:** 10–20 hours
- **Proposed total:** 19 hours
- **Status:** ✅ Within range (upper end)

## Justification

The estimation is at the upper end of the 5 SP range (10–20h) because:

1. **Inference algorithm complexity (T-4.05-02, 5h):** The rule-based matcher requires multi-language dictionaries (ES/EN/PT), Levenshtein fuzzy matching, confidence scoring, no-header detection heuristics, and content-type validation. This is the most technically complex task.

2. **Use case orchestration (T-4.05-05, 4h):** The `InferColumnMapping` use case must handle 5 distinct Gherkin scenarios, persist mappings, format messages with emoji indicators, and handle multiple error paths (token errors, missing config, missing preview).

3. **Integration with existing scaffold:** While the runtime scaffold (Fastify, DB, Redis, FSM, messaging, spreadsheet adapters) already exists, integrating the new use case into the message worker and ensuring backward compatibility with `RegisterExpense`'s `GasttoField` naming requires careful attention.

4. **Documentation and testing (T-4.05-07, 3h):** The project requires canonical feature docs and comprehensive test coverage for all FSM transitions.

The estimation reflects the actual work considering the project's Clean Architecture, TypeScript strictness, and testing conventions.

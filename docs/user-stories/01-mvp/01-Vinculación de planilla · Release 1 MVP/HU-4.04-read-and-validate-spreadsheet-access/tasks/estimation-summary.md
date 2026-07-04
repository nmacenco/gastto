# Estimation Summary — HU-4.04

## Total Estimated Hours

**12.0 hours**

## Hours per Task

| Task ID | Title | Layer | Estimated Hours |
|---|---|---|---|
| T-4.04-01 | Define spreadsheet access domain port and value objects | Domain | 1.5 |
| T-4.04-02 | Implement Google Sheets preview and write-permission adapter | Infrastructure | 2.5 |
| T-4.04-03 | Implement Excel Online preview and write-permission adapter | Infrastructure | 2.5 |
| T-4.04-04 | Implement validate spreadsheet access use case | Application | 2.5 |
| T-4.04-05 | Wire conversation handler to validate access | Interfaces | 2.0 |
| T-4.04-06 | QA scenarios and feature documentation update | Cross-cutting | 1.0 |
| **Total** | | | **12.0** |

## Coherence Check with Story Points

- **Story Points:** 3
- **Expected range for 3 SP:** 6–12 hours
- **Estimated total:** 12.0 hours

The estimate sits at the **upper bound** of the 3 SP range. This is justified by the User Story's own justification: _"Technically requires permission handling across two distinct APIs and robust error management. Retry and empty-sheet detection add non-trivial test cases."_

Two separate API integrations (Google Sheets + Excel Online), each requiring preview reading, write-permission checking, empty-sheet detection, and error handling, drive the estimate to the upper end. The conversational interface is minimal (transparent on success, messages only on error), which keeps the Interfaces-layer effort low.

## Estimation Justification

- **Domain (1.5h):** Defining the port interface and value objects is straightforward given existing project patterns.
- **Infrastructure (5.0h total):** Two adapters, each at 2.5h, covering API calls, permission checks, error mapping, and mocked tests.
- **Application (2.5h):** Use case with retry logic, four-scenario branching, and message construction.
- **Interfaces (2.0h):** Handler wiring, Zod validation, DI registration, and integration tests.
- **Cross-cutting (1.0h):** QA validation of all four scenarios and documentation update.

The distribution reflects the project's Clean Architecture stack (TypeScript, Fastify, Zod, Vitest) and the fact that the bulk of complexity lies in the two external API adapters.

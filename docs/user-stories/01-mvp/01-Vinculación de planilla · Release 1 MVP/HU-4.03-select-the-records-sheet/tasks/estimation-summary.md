# Estimation Summary

## Total Hours

**7.0 hours**

## Hours per Task

| Task ID   | Title                                         | Hours   |
| --------- | --------------------------------------------- | ------- |
| T-4.03-01 | Extend SpreadsheetPort with listSheets        | 0.5     |
| T-4.03-02 | Implement GoogleSheetsAdapter                 | 1.5     |
| T-4.03-03 | Create DrizzleSpreadsheetConfigRepository     | 1       |
| T-4.03-04 | Implement HandleSheetSelection use case       | 2       |
| T-4.03-05 | Add onboarding copies for sheet selection     | 0.5     |
| T-4.03-06 | Integrate sheet selection into message worker | 0.5     |
| T-4.03-07 | Write tests and feature documentation         | 1.5     |
| **Total** |                                               | **7.0** |

## Coherence Check with Story Points

- **User Story Story Points:** 2 SP
- **Nominal range for 2 SP:** 4 – 8 hours
- **Estimated total:** 7.0 hours
- **Status:** ✅ Within range

## Justification

The estimation sits in the upper half of the 2 SP range because:

1. **Missing foundational scaffolding:** The `GoogleSheetsAdapter` and `DrizzleSpreadsheetConfigRepository` do not yet exist in the codebase. Creating them now carries extra effort that later HUs (4.04–4.07) will reuse.
2. **Conversational branching:** The `HandleSheetSelection` use case must handle five distinct interaction modes (single sheet auto-confirm, multi-sheet list, name fuzzy match, "I don't know" with header descriptions, invalid re-prompt). This requires careful state management inside `statePayload`.
3. **Schema workaround:** Because `spreadsheet_configs.access_verified_at` is `NOT NULL`, the repository must accept a placeholder timestamp on creation (Option A). This adds a small but non-zero complexity that must be documented and tested.
4. **Test coverage:** The project requires meaningful assertions, boundary mocking, and feature documentation for every functional change. Test and doc work is explicitly estimated rather than absorbed into other tasks.
5. **No bootstrap overhead:** The runtime scaffold (Fastify, BullMQ, Redis, Drizzle, messaging adapters) already exists thanks to HU-4.01 and HU-4.02. No additional bootstrap task is needed.

# Estimation Summary

## Total Hours

**10.5 hours**

## Hours per Task

| Task ID   | Title                                             | Hours    |
| --------- | ------------------------------------------------- | -------- |
| T-4.02-01 | Define CloudStorage file discovery port and DTOs  | 1.5      |
| T-4.02-02 | Implement Google Drive file discovery adapter     | 2        |
| T-4.02-03 | Implement HandleSpreadsheetFileSelection use case | 2.5      |
| T-4.02-04 | Integrate file selection into message worker      | 1.5      |
| T-4.02-05 | Add onboarding copies for file selection flow     | 1        |
| T-4.02-06 | Write tests and feature documentation             | 2        |
| **Total** |                                                   | **10.5** |

## Coherence Check with Story Points

- **User Story Story Points:** 3 SP
- **Nominal range for 3 SP:** 6 – 12 hours
- **Estimated total:** 10.5 hours
- **Status:** ✅ Within range

## Justification

The estimation sits in the upper half of the 3 SP range because:

1. **API normalization:** Google Drive API v3 responses for `.xlsx`, `.ods`, and Google Sheets must be unified into a single `CloudFile` DTO. This requires careful mimeType mapping and date parsing.
2. **Conversational branching:** The `ONBOARDING_FILE` state has five distinct interaction modes (list selection, name search, direct URL, no files found, invalid re-prompt). The use case must track the current sub-mode inside `statePayload` and route accordingly.
3. **State persistence constraints:** Because the `spreadsheet_configs` table has `sheetName` and `accessVerifiedAt` as `NOT NULL`, the selected file cannot be persisted to its final table yet. The use case must store it temporarily in `conversationStates.statePayload`, adding complexity to state management that will be resolved in HU-4.03 and HU-4.04.
4. **Test coverage:** The project requires meaningful assertions, boundary mocking, and feature documentation for every functional change. Test and doc work is explicitly estimated rather than absorbed into other tasks.
5. **No bootstrap overhead:** The runtime scaffold (Fastify, BullMQ, Redis, Drizzle, messaging adapters) already exists thanks to HU-4.01 and earlier stories. No additional bootstrap task is needed.

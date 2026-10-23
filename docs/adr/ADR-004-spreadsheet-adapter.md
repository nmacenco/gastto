# ADR-004: Integrate Spreadsheets via Adapter Pattern

**Date**: 2025-04
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

The MVP must simultaneously support two cloud storage providers: Google Drive (Sheets) and OneDrive (Excel Online). Spreadsheet structure is unknown until onboarding time, and can vary per user. The system must be able to read, write, and map columns dynamically without assuming a fixed structure.

Google and Microsoft APIs are sufficiently different (authentication, response formats, permission handling) to require separate implementations.

## Considered Options

1. **Single adapter for both Google and Microsoft**
   - Pros: One implementation to maintain.
   - Cons: The APIs are different enough that a unified adapter generates more complexity than two clean adapters with a common interface.

2. **Direct integration without abstraction**
   - Pros: Fastest to implement.
   - Cons: Any API change from either provider would require modifying business logic. Violates the dependency inversion principle.

3. **Adapter Pattern with unified interface and independent implementations**
   - Pros: Total decoupling, easy to add new providers, clean separation of concerns.
   - Cons: Slightly more initial setup.

## Decision

Implement the **Adapter Pattern** in the Infrastructure layer of Clean Architecture, with an independent adapter per provider and a common interface.

**Unified interface `SpreadsheetPort`:**

```typescript
interface SpreadsheetPort {
  readRows(sheetId: string, range: string): Promise<Row[]>;
  appendRow(
    sheetId: string,
    sheetName: string,
    values: CellValue[],
  ): Promise<{ sheet: string; row: number }>;
  deleteRow(sheetId: string, sheetName: string, rowIndex: number): Promise<void>;
  getUniqueValues(sheetId: string, column: string): Promise<string[]>;
  getHeaders(sheetId: string, sheetName: string): Promise<string[]>;
  validateAccess(sheetId: string): Promise<boolean>;
}
```

`readRows()` accepts one provider-neutral, worksheet-qualified A1 range. The first
cell must contain a positive 1-based row, for example `Gastos!A2:F` or
`'Gastos 2026'!A2:F50`. Both adapters validate this contract before performing a
provider request and return each row with its real 1-based worksheet index.

**Implementations:** `GoogleSheetsAdapter` and `ExcelOnlineAdapter`, both implementing `SpreadsheetPort`.

**Dynamic column mapping:** The onboarding result (column inference in E4-US-05 and E4-US-06) is persisted in the database as `MappingConfig` per user. This mapping relates AI-extracted entities to the file's actual column indices (e.g. `"monto" → Column B`). The mapping is cached in Redis with a 1-hour TTL to avoid unnecessary API calls on every registration.

**Proactive permission verification:** During onboarding, the system executes a test append to a temporary row and immediately deletes it, confirming read and write access before the user attempts their first expense save.

## Rationale

- Total decoupling from storage provider: an API change in one provider only affects its adapter.
- Easy to add new providers in the future (Notion, standalone Excel Online) by implementing the interface.
- Proactive permission verification prevents access errors on the first real save.

## Consequences

### Positive

- Total decoupling from storage provider.
- Easy to add new providers by implementing the interface.
- Proactive permission verification prevents first-save errors.
- Row consumers remain provider-independent because both adapters preserve cell
  types, blank-column offsets, and absolute worksheet row indexes.

### Negative

- Dynamic column mapping is the most complex onboarding user story: a poor inference algorithm produces incorrect mappings that destroy user trust.
- Need to manage and refresh OAuth tokens for two providers securely (see ADR-007).
- Duplicates authentication surface and security test cases from the start.

## References

- [`docs/adr/ADR-007-oauth-aes256.md`](./ADR-007-oauth-aes256.md)
- [`docs/user-stories/01-mvp/01-Vinculación de planilla · Release 1 MVP/`](../user-stories/01-mvp/01-Vinculación%20de%20planilla%20·%20Release%201%20MVP/)

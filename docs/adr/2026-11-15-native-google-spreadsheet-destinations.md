# ADR-033: Require native Google spreadsheet destinations

**Date**: 2026-11-15
**Status**: Accepted
**Deciders**: Product owner (approved implementation plan)

## Context

Drive discovery previously included XLSX and ODS while the destination adapter uses Google Sheets operations. Accessibility alone cannot establish format compatibility, and a Sheets HTTP 400 does not establish the file's format.

## Considered Options

1. Accept all spreadsheet MIME types: broad discovery, but incompatible selections reach Sheets.
2. Automatically convert files: additional permissions and user-visible copies outside the approved scope.
3. Require native Google spreadsheets: explicit format boundary, with user-managed conversion.

## Decision

List/search only native Google spreadsheets and revalidate MIME metadata for every selection. Return a discriminated accessibility result and retain typed exceptions for malformed metadata, transport and authorization failures.

## Rationale

The same boundary covers URLs, numeric choices and historical semantic references. Users explicitly choose the converted file. Errors use contextual recovery without treating HTTP 400 as a format diagnosis.

## Consequences

### Positive

- Unsupported selections cannot reach Sheets or activate a destination.
- Bounded diagnostics preserve provider classification without exposing provider text.
- Existing guarded cancellation, OAuth recovery and financial claims remain intact.

### Negative

- Users must convert XLSX/ODS manually and select the converted file.
- Selection requires a metadata request even for previously displayed files.

## References

- [File selection](../features/select-spreadsheet-file.md)
- [Chat settings](../features/chat-spreadsheet-settings.md)
- [Implementation plan](../../ai/plans/2026_11_15-spreadsheet_compatibility_and_flow_recovery/2026_11_15-spreadsheet_compatibility_and_flow_recovery-plan.md)

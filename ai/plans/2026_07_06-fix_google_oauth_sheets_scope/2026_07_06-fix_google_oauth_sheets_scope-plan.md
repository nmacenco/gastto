# Goal

Ensure Google OAuth tokens obtained during onboarding are authorized to write to Google Sheets by requesting the Sheets write scope, and reject any previously stored tokens that lack it.

# Context

- `src/infrastructure/adapters/oauth/GoogleDriveOAuthAdapter.ts`: Builds the authorization URL with only `https://www.googleapis.com/auth/drive.readonly`.
- `src/infrastructure/adapters/oauth/GoogleDriveOAuthAdapter.spec.ts`: Contract tests assert the current single scope.
- `src/infrastructure/adapters/sheets/GoogleSheetsAdapter.ts`: Checks Drive `capabilities.canEdit`, which is not sufficient to guarantee Sheets write access.
- `src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess.ts`: Orchestrates access validation; natural place to enforce the scope requirement on stored tokens.
- `docs/features/cloud-storage-connection.md`: Documents the OAuth flow and requested scopes.
- `docs/features/validate-spreadsheet-access.md`: Documents validation behavior.

# Public contracts

- Google OAuth authorization URL scope string.
- `GoogleDriveOAuthAdapter.spec.ts` test expectations.
- `ValidateSpreadsheetAccess` behavior for stored tokens that are missing the `spreadsheets` scope.
- `ValidateSpreadsheetAccess.spec.ts` test cases.

# Phases

## Phase 1: Request the Sheets write scope

Request both `drive.readonly` and `spreadsheets` scopes during the Google OAuth flow and update the contract tests and documentation.

- [x] Add a `GOOGLE_SHEETS_SCOPE` constant and update `GoogleDriveOAuthAdapter.buildAuthUrl` to request `https://www.googleapis.com/auth/drive.readonly` plus `https://www.googleapis.com/auth/spreadsheets` as a space-separated scope string.
- [x] Update `GoogleDriveOAuthAdapter.spec.ts` expected scope strings and arrays to include both scopes.
- [x] Update `docs/features/cloud-storage-connection.md` to document the requested scopes and note that changing the scope set requires users to re-consent.
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 2: Guard against stored tokens that lack the Sheets scope

Before validating spreadsheet access, ensure the stored OAuth token for Google includes the `spreadsheets` scope. If it does not, force a reconnect so the user re-authorizes with the correct scopes.

- [x] In `ValidateSpreadsheetAccess`, after retrieving the token and before creating the validation port, check `token.scope` for Google. If `https://www.googleapis.com/auth/spreadsheets` is missing, return the reconnect flow.
- [x] Add/update unit tests in `ValidateSpreadsheetAccess.spec.ts` covering the missing-scope reconnect path.
- [x] Update `docs/features/validate-spreadsheet-access.md` to note the scope check.
- [x] Run `pnpm lint` and `pnpm typecheck`. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

# Next step

All phases are complete. Export the conversation and store it as `ai/plans/2026_07_06-fix_google_oauth_sheets_scope/2026_07_06-fix_google_oauth_sheets_scope-conversation.md`, then commit the changes.

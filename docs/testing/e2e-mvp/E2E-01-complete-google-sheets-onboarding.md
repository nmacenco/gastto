# E2E-01: Complete Google Sheets Onboarding

- [x] Passed.

## Objective

Prove that a new Telegram user can link Google Drive, select a spreadsheet and sheet, validate access, accept the proposed mapping and categories, and reach a ready-to-use conversation.

## Preconditions

- The test user has never completed onboarding.
- The disposable spreadsheet described in the suite README is available with Google edit permission.

## Steps

1. Start a chat with the test bot and begin onboarding.
2. Choose Google Drive and open the authorization link.
3. Grant the requested Google permissions and return to Telegram.
4. Select the disposable spreadsheet from the displayed list or by its exact name.
5. Select `Expenses` when prompted for the sheet.
6. Wait for access validation and the proposed column mapping.
7. Confirm the mapping.
8. Confirm the displayed category vocabulary.

## Expected Results

- Google authorization succeeds and Telegram confirms the connection.
- The selected file and `Expenses` sheet are confirmed.
- The system validates both read and write access without asking for an additional message.
- The mapping proposal associates the five test headers with date, description, amount, currency, and category.
- Category confirmation finishes onboarding and sends a welcome or ready message.
- The user can now send an expense message; no onboarding prompt remains.

## Result

- Date: 2026-08-27
- Tester: Niko
- Environment: develop
- Evidence:
- Notes: The bug discovered during testing was fixed and committed in `71e561e`.

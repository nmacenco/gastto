# MVP Manual End-to-End Test Suite

## Purpose

This suite validates the complete MVP through the real Telegram, Google OAuth, and Google Sheets integrations. It is a manual release checklist, not an automated test suite.

## Scope

Eleven cases cover the MVP user journeys and the linked-subcategory extension. Eight cases validate the original MVP path and its recovery boundaries; three additional release-gate cases validate hierarchy onboarding, parent-aware correction, and saving with or without a selected subcategory.

| ID     | Case                                                       | Type          | Covers                                              |
| ------ | ---------------------------------------------------------- | ------------- | --------------------------------------------------- |
| E2E-01 | Complete Google Sheets onboarding.                         | Release gate. | HU-4.01 to HU-4.07.                                 |
| E2E-02 | Register and save a complete expense.                      | Release gate. | E1-US-01 to E1-US-04, E1-US-06, E1-US-08, E1-US-10. |
| E2E-03 | Clarify missing data and save.                             | Release gate. | E1-US-05.                                           |
| E2E-04 | Correct an interpreted expense before saving.              | Release gate. | E1-US-06 to E1-US-08.                               |
| E2E-05 | Cancel an in-progress expense safely.                      | Release gate. | E1-US-09.                                           |
| E2E-06 | Recover safely from a spreadsheet save failure.            | Regression.   | E1-US-12.                                           |
| E2E-07 | Undo the latest saved expense.                             | Regression.   | E1-US-11.                                           |
| E2E-08 | Correct mapping and category vocabulary during onboarding. | Regression.   | HU-4.05 to HU-4.07.                                 |
| E2E-09 | Detect and confirm a linked category hierarchy.            | Release gate. | HU-4.08.                                            |
| E2E-10 | Correct and save a linked subcategory.                     | Release gate. | E1-US-18.                                           |
| E2E-11 | Save an expense without an applicable subcategory.         | Release gate. | E1-US-18.                                           |

Run the cases in numeric order. E2E-01 creates the linked account and base spreadsheet configuration used by the original expense cases. E2E-08 and E2E-09 require a fresh test user or a reset onboarding configuration. E2E-10 and E2E-11 use the hierarchy confirmed in E2E-09.

## Test Setup

- Use a dedicated Telegram test bot and test user, never a personal or production conversation.
- Use a dedicated Google account and disposable spreadsheet. Do not use a spreadsheet containing real financial data.
- Create a sheet named `Expenses` with headers `Date`, `Description`, `Amount`, `Currency`, and `Category`. Add at least two category values below the header: `Food` and `Transport`.
- Record the starting row count before every case that can write to the sheet.
- Capture Telegram screenshots and the relevant spreadsheet rows for each completed case.
- Mark a case complete only when every expected result is observed. Record any deviation in its Result section.

## Results

Each case starts with a Markdown checkbox. Change `[ ]` to `[x]` after it passes, then fill in the execution date, tester, environment, and evidence links. A failed or blocked case must remain unchecked.

## Related Documentation

- [Testing guidelines](../guidelines.md).
- [Cloud storage connection](../../features/cloud-storage-connection.md).
- [Expense confirmation](../../features/expense-confirmation.md).
- [Subcategory hierarchy](../../features/subcategory-hierarchy.md).
- [Undo last expense](../../features/undo-last-expense.md).

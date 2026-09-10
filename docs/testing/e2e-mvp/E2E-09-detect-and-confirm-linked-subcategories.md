# E2E-09: Detect and Confirm Linked Subcategories

- [ ] Passed.

## Objective

Prove that onboarding detects category/subcategory relationships row by row, preserves an equal child name under different parents, excludes orphan subcategories, and confirms the reviewed hierarchy.

## Preconditions

- Use a fresh test user or reset the test user's onboarding state.
- Use a disposable `Expenses` sheet with mapped `Category` and `Subcategory` columns.
- Add these values before onboarding, preserving the empty cells shown below:

| Category | Subcategory |
| -------- | ----------- |
| Food     | Supermarket |
| Food     | Restaurant  |
| Leisure  | Restaurant  |
|          | Streaming   |

## Steps

1. Complete Google authorization, file selection, and sheet selection.
2. Confirm a column mapping that includes both `Category` and `Subcategory`.
3. Review the hierarchy proposed by the bot.
4. Verify that `Restaurant` appears once under `Food` and once under `Leisure`.
5. Verify that `Streaming` appears in a separate orphan warning and not under any category.
6. Reply `agregar Delivery a Food` and review the updated hierarchy.
7. Confirm the hierarchy using `sí` or the Confirm button.
8. Send a new message after onboarding completes and verify that the bot accepts it as a normal expense message rather than restarting onboarding.
9. Cancel that in-progress expense so the user is ready for E2E-10.

## Expected Results

- The proposal preserves `Food > Supermarket`, `Food > Restaurant`, and `Leisure > Restaurant` as distinct row-derived relationships.
- The equal normalized name `Restaurant` is retained under both parents and is not collapsed globally.
- `Streaming` is named in an orphan warning, is excluded from the hierarchy, and is not assigned an inferred parent.
- The accepted modification adds only `Food > Delivery` and re-displays the complete updated hierarchy.
- Confirmation completes onboarding once and the conversation returns to the normal expense flow.
- Cancelling the verification expense returns the conversation to its idle state without writing a row.

## Result

- Date:
- Tester:
- Environment:
- Evidence:
- Notes:

# E2E-08: Correct Mapping and Category Vocabulary During Onboarding

- [ ] Passed.

## Objective

Prove that a user can correct a proposed spreadsheet mapping, modify the detected category vocabulary, and finish onboarding with the revised configuration.

## Preconditions

- Use a fresh test user or reset the test user's onboarding state.
- Use a disposable sheet whose category header is `Expense type` and whose category values include `Meals` and `Travel`.

## Steps

1. Complete Google authorization, file selection, and sheet selection.
2. When the column mapping proposal appears, reply `la categoría está en la columna E`.
3. Confirm the updated mapping.
4. When categories are presented, reply `Meals se llama Food`.
5. Confirm the revised category list.
6. Send `Pagué 10 EUR por almuerzo`, confirm it, and inspect the saved row.

## Expected Results

- The mapping is re-displayed after the correction and assigns the category field to column E.
- Confirmation advances to category setup without restarting onboarding.
- The category-vocabulary change is shown before the final confirmation.
- Final confirmation completes onboarding.
- The subsequent expense is saved with `Food` in the corrected category column.

## Result

- Date:
- Tester:
- Environment:
- Evidence:
- Notes:

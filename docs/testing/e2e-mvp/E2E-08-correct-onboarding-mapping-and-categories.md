# E2E-08: Correct Mapping and Category Vocabulary During Onboarding

- [ ] Passed.

## Objective

Prove that a user can correct a proposed spreadsheet mapping, modify the detected category vocabulary, and finish onboarding with the revised configuration.

## Preconditions

- Use a fresh test user or reset the test user's onboarding state.
- Use a disposable sheet whose category header is `Expense type` and whose category values include `Meals` and `Travel`.

## Steps

1. Complete Google authorization, file selection, and sheet selection.
2. When the column mapping proposal appears, reply `A medio de pago, B fecha, C categoría, E monto, F concepto`.
3. Verify that the bot asks for one correction per message and does not display a partially updated mapping.
4. Reply `la categoría está en la columna E`.
5. Verify that `Categoría → columna E` appears even if `Categoría` was absent from the original proposal, then confirm the updated mapping.
6. When categories are presented, reply `Meals se llama Food`.
7. Confirm the revised category list.
8. Send `Pagué 10 EUR por almuerzo`, confirm it, and inspect the saved row.

## Expected Results

- A message containing several field assignments is rejected with one-field-per-message guidance and does not apply any assignment.
- The mapping is re-displayed after the correction and assigns the category field to column E.
- A corrected field that was originally unmapped is added to the displayed mapping rather than silently discarded.
- After confirmation, the corrected mapping is persisted and used by subsequent expense writes.
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

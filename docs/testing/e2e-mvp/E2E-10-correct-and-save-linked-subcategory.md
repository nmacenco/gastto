# E2E-10: Correct and Save a Linked Subcategory

- [ ] Passed.

## Objective

Prove that a reviewed expense keeps subcategories scoped to their parent, rejects an invalid cross-parent correction without changing the summary, and writes a valid corrected subcategory to the mapped spreadsheet column.

## Preconditions

- E2E-09 has passed for the test user.
- The confirmed hierarchy contains `Food > Restaurant` and `Food > Delivery`, while `Leisure` does not contain `Delivery`.
- Record the current row count in `Expenses`.

## Steps

1. Send `Pagué 35 EUR por una cena en un restaurante` to the bot.
2. Review the interpreted category and subcategory in the expense summary.
3. If necessary, correct the selection to `Food > Restaurant` and wait for the updated summary.
4. Reply with a child-only correction: `la subcategoría es Delivery`.
5. Verify that the summary now shows `Food > Delivery` exactly once.
6. Reply `la categoría es Leisure` without supplying a replacement subcategory.
7. Verify that the updated summary keeps `Leisure` but clears `Delivery` and shows `❓ Sin subcategoría`.
8. Reply `la subcategoría es Delivery`.
9. Verify that the bot rejects the correction, lists the valid children for `Leisure`, and leaves the displayed summary unchanged.
10. Correct the expense back to `Food, subcategoría Delivery`.
11. Confirm the expense and inspect the appended spreadsheet row.

## Expected Results

- The hierarchy-enabled summary displays category and subcategory on separate lines with independent review markers.
- A child-only correction is resolved only within the currently selected parent.
- Changing the parent without a valid replacement child clears the previous subcategory and keeps the expense pending confirmation.
- The cross-parent child correction is rejected without partially changing the reviewed category, amount, currency, date, or description.
- The valid combined correction produces one updated summary with `Food > Delivery`.
- No row is written before confirmation.
- Exactly one row is appended after confirmation, with `Food` and `Delivery` in their mapped columns, followed by one successful-save message.

## Result

- Date:
- Tester:
- Environment:
- Evidence:
- Notes:

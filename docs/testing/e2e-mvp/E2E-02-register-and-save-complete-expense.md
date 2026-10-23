# E2E-02: Register and Save a Complete Expense

- [x] Passed.

## Objective

Prove that a complete free-text expense is acknowledged, interpreted, reviewed, confirmed, and written once to the selected Google Sheet.

## Preconditions

- E2E-01 has passed for the test user.
- Record the current row count in `Expenses`.

## Steps

1. Send `Pagué 12,50 EUR por almuerzo` to the bot.
2. Observe the receipt acknowledgement before the interpretation completes.
3. Review the expense summary.
4. Confirm it using `sí` or the Confirm button.
5. Open the `Expenses` sheet and inspect the appended row.

## Expected Results

- The bot acknowledges receipt promptly and shows one review summary.
- The summary contains amount `12.50`, currency `EUR`, and an appropriate food category; low-confidence category copy is acceptable when clearly marked for review.
- No row is written before confirmation.
- Confirmation produces one successful-save message naming `Expenses` and its row when the provider returns a row number.
- Exactly one new row is appended, with the reviewed values in their mapped columns.

## Result

- Date: 2026-08-29
- Tester: Nico
- Environment: development
- Evidence:
- Notes: All expected results passed.

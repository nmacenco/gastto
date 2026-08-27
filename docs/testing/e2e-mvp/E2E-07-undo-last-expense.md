# E2E-07: Undo the Latest Expense

- [ ] Passed.

## Objective

Prove that an immediate undo removes only the most recently saved expense and synchronizes the Google Sheet with the local record.

## Preconditions

- E2E-01 has passed.
- Record the current row count in `Expenses`.

## Steps

1. Send and confirm `Pagué 7 EUR por metro`.
2. Verify that one row was added.
3. Immediately send `deshacer`, without sending any other message first.
4. Inspect the bot response and the spreadsheet.
5. Send `deshacer` again.

## Expected Results

- The first command removes the just-saved metro expense and reports a successful undo.
- The sheet returns to its original row count; no unrelated row is removed.
- A second undo is handled safely and does not delete another expense when none is eligible.
- No technical provider details are exposed in either response.

## Result

- Date:
- Tester:
- Environment:
- Evidence:
- Notes:

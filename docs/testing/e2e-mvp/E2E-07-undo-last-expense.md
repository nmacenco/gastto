# E2E-07: Undo the Latest Expense

- [ ] Passed.
- [x] Rejected pending fix verification.

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

- Date: 2026-09-02
- Tester: Nico
- Environment: `develop`
- Evidence: The newly created expense was saved and the first `deshacer` removed it as expected. Sending `deshacer` a second consecutive time immediately removed an older expense that had appeared earlier in the conversation history, without asking for confirmation.
- Notes: Rejected because the second undo deleted an unrelated older expense when no immediate-undo eligibility should have remained. Re-run this scenario in `develop` after the fix is deployed.

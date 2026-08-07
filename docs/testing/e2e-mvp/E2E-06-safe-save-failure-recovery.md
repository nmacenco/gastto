# E2E-06: Safe Save-Failure Recovery

- [ ] Passed.

## Objective

Prove that a failed spreadsheet write does not produce a false success or a local expense record, and that the user receives a recovery path.

## Preconditions

- E2E-01 has passed.
- A controlled fault is available in the test environment: temporarily revoke the test user's spreadsheet edit permission, or use the staging adapter fault mechanism.
- Record the current row count in `Expenses`.

## Steps

1. Remove the bot's ability to write to the disposable spreadsheet, or activate the approved controlled failure.
2. Send `Pagué 18 EUR por cena` and confirm the review summary.
3. Observe the response after the failed save.
4. Restore write permission or disable the controlled fault.
5. Follow the recovery instruction shown by the bot. Use `reintentar` only for a retryable network fault; use the offered reconnect or reconfigure path for authorization or structure failures.

## Expected Results

- The bot does not send a successful-save confirmation while the write fails.
- No row is appended during the failed attempt.
- The error message is understandable and gives a specific next action; it does not expose provider internals.
- For a retryable network fault, one user-initiated retry can save the pending reviewed expense after the fault is restored.
- For an authorization or structure fault, the bot directs the user to reauthorize or reconfigure instead of claiming that a retry succeeded.

## Result

- Fault type:
- Date:
- Tester:
- Environment:
- Evidence:
- Notes:

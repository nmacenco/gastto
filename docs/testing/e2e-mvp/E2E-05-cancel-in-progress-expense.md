# E2E-05: Cancel an In-Progress Expense Safely

- [x] Passed.

## Objective

Prove that cancellation removes an active draft without changing the spreadsheet and that a later expense starts with fresh data.

## Preconditions

- E2E-01 has passed.
- Record the current row count in `Expenses`.

## Steps

1. Send `Compré un libro`.
2. When asked for the missing amount, send `cancelar`.
3. Verify the cancellation response.
4. Send `Pagué 9 EUR por bus`.
5. Confirm the new review summary and inspect the sheet.

## Expected Results

- Cancellation states that nothing was saved.
- The row count is unchanged after cancellation.
- The new expense is processed independently; it does not include the cancelled `libro` context.
- After confirming the new expense, exactly one row is appended for the bus expense.

## Result

- Date: 2026-09-01
- Tester: Ternico
- Environment: developed
- Evidence: Flujo ejecutado íntegramente: la cancelación indicó que no se guardó nada, el número de filas permaneció sin cambios y el gasto posterior del bus se procesó de forma independiente y guardó exactamente una fila.
- Notes: Passed.

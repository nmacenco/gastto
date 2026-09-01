# E2E-03: Clarify Missing Expense Data and Save

- [ ] Passed.

## Objective

Prove that Gastto asks for missing information one item at a time, retains context, and saves only after the completed expense is confirmed.

## Preconditions

- E2E-01 has passed.
- Record the current row count in `Expenses`.

## Steps

1. Send `Compré café`.
2. Reply `4,50` to the amount question.
3. Reply `EUR` if the bot asks for the currency.
4. Review the completed expense summary.
5. Confirm the summary.

## Expected Results

- The first response asks only for the missing amount; it does not ask multiple questions at once.
- After the amount, the bot asks only for currency when it cannot derive one from the user profile or message.
- The review summary retains the original concept, `café`, plus the supplied amount and currency.
- No spreadsheet row exists before confirmation.
- One confirmed row is appended after confirmation.

## Result

- Date: 2026-08-29
- Tester: Nico
- Environment: development
- Evidence: Conversation transcript supplied by the tester.
- Notes: Failed. After `Compre cafe`, the bot sent the generic instruction to provide an amount and concept instead of asking only for the missing amount while retaining `cafe`. A subsequent transaction-style message produced `Parece que algo falló. Vamos a empezar de nuevo.` Sending `cancelar` then returned `No hay ningún registro pendiente para cancelar.`, confirming that the pending expense context had been lost. Repeating the transaction-style message produced the same error and reset response.

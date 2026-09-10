# E2E-11: Save Without an Applicable Subcategory

- [ ] Passed.

## Objective

Prove that a hierarchy-enabled user can confirm and save an expense whose category has no applicable child, without inventing a subcategory or shifting spreadsheet columns.

## Preconditions

- E2E-09 has passed for the test user.
- The confirmed hierarchy includes the category `Leisure` and its mapped `Subcategory` column, but the test message does not match any active child under `Leisure`.
- Record the current row count in `Expenses` and the positions of all mapped columns.

## Steps

1. Send `Pagué 20 EUR por una entrada a una exposición de arte` to the bot.
2. If necessary, correct only the category to `Leisure` without naming a subcategory.
3. Review the updated expense summary.
4. Confirm the expense using `sí` or the Confirm button.
5. Inspect the appended row in `Expenses`.

## Expected Results

- The summary preserves `Leisure` as the category and explicitly shows `❓ Sin subcategoría`.
- The bot does not automatically select a child merely because the hierarchy is enabled or because the parent has configured children.
- The expense can be confirmed without an additional clarification cycle.
- No row is written before confirmation.
- Exactly one row is appended after confirmation.
- The mapped `Subcategory` cell is empty, and every other value remains in its configured column without shifting.
- The bot sends one successful-save message.

## Result

- Date:
- Tester:
- Environment:
- Evidence:
- Notes:

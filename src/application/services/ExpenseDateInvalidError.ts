// LAYER: Application
import type { ExpenseCalendarDateResult } from './resolveExpenseCalendarDate';

export class ExpenseDateInvalidError extends Error {
  readonly code = 'EXPENSE_DATE_INVALID';

  constructor(readonly reason: Extract<ExpenseCalendarDateResult, { kind: 'invalid' }>['reason']) {
    super('Invalid extracted expense date');
    this.name = 'ExpenseDateInvalidError';
  }
}

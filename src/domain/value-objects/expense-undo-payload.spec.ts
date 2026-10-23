import { describe, expect, it } from 'vitest';
import { parseExpenseUndoPayload } from './expense-undo-payload';

describe('parseExpenseUndoPayload()', () => {
  it('keeps a legacy target unbound until it is re-presented', () => {
    expect(parseExpenseUndoPayload({ pendingExpenseId: 'expense-1' })).toEqual({
      pendingExpenseId: 'expense-1',
      actionBinding: null,
    });
  });

  it('accepts only a strict action binding', () => {
    const actionBinding = {
      operationId: 'abcdefghijklmnopqrstuv',
      revision: 1,
      presentedAt: '2026-09-12T10:00:00.000Z',
    };
    expect(parseExpenseUndoPayload({ pendingExpenseId: 'expense-1', actionBinding })).toEqual({
      pendingExpenseId: 'expense-1',
      actionBinding,
    });
    expect(
      parseExpenseUndoPayload({
        pendingExpenseId: 'expense-1',
        actionBinding: { ...actionBinding, revision: 0 },
      }),
    ).toBeNull();
  });
});

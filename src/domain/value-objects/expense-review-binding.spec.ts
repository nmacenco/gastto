// LAYER: Domain / Tests

import { describe, expect, it } from 'vitest';
import {
  advanceExpenseReviewBinding,
  createExpenseReviewBinding,
  normalizeExpenseReviewBinding,
} from './expense-review-binding';

describe('expense review binding', () => {
  it('creates a random 128-bit base64url operation identity', () => {
    const first = createExpenseReviewBinding();
    const second = createExpenseReviewBinding();

    expect(first.operationId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first).toMatchObject({ revision: 1, presentedAt: null });
    expect(second.operationId).not.toBe(first.operationId);
  });

  it('advances the displayed review and clears presentation evidence', () => {
    expect(
      advanceExpenseReviewBinding({
        operationId: 'abcdefghijklmnopqrstuv',
        revision: 7,
        presentedAt: '2026-09-13T10:00:00.000Z',
      }),
    ).toEqual({ operationId: 'abcdefghijklmnopqrstuv', revision: 8, presentedAt: null });
  });

  it('rotates the operation identity on safe-integer overflow', () => {
    const next = advanceExpenseReviewBinding({
      operationId: 'abcdefghijklmnopqrstuv',
      revision: Number.MAX_SAFE_INTEGER,
      presentedAt: null,
    });

    expect(next.operationId).not.toBe('abcdefghijklmnopqrstuv');
    expect(next.revision).toBe(1);
  });

  it.each([
    { operationId: 'short', revision: 1, presentedAt: null },
    { operationId: 'abcdefghijklmnopqrstuv', revision: 0, presentedAt: null },
    { operationId: 'abcdefghijklmnopqrstuv', revision: 1, presentedAt: 'yesterday' },
    { operationId: 'abcdefghijklmnopqrstuv', revision: 1, presentedAt: null, extra: true },
  ])('rejects malformed persisted bindings', (binding) => {
    expect(() => normalizeExpenseReviewBinding(binding)).toThrow();
  });
});

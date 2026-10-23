// LAYER: Domain / Tests

import { describe, expect, it } from 'vitest';
import { encodeExpenseReviewCallback, parseExpenseReviewCallback } from './expense-review-callback';

describe('expense review callback codec', () => {
  const operationId = 'abcdefghijklmnopqrstuv';

  it.each([
    ['confirm', 'c'],
    ['correct', 'e'],
    ['cancel', 'x'],
  ] as const)('round-trips %s in the compact wire format', (action, code) => {
    const encoded = encodeExpenseReviewCallback(action, operationId, 35);

    expect(encoded).toBe(`er1:${code}:${operationId}:z`);
    expect(Buffer.byteLength(encoded, 'utf8')).toBeLessThanOrEqual(64);
    expect(parseExpenseReviewCallback(encoded)).toEqual({
      version: 1,
      action,
      operationId,
      reviewRevision: 35,
    });
  });

  it.each([
    'er1:c:short:1',
    `er1:q:${operationId}:1`,
    `er1:c:${operationId}:0`,
    `er1:c:${operationId}:1:trailing`,
    `er1:c:${operationId}:zzzzzzzzzzzzzzzzzzzz`,
  ])('marks malformed versioned data as invalid: %s', (data) => {
    expect(parseExpenseReviewCallback(data)).toEqual({ invalid: true });
  });

  it('keeps the old JSON shape as explicitly unbound legacy data', () => {
    expect(parseExpenseReviewCallback('{"action":"confirm"}')).toEqual({ action: 'confirm' });
    expect(parseExpenseReviewCallback('{"action":"cancel","extra":true}')).toBeNull();
  });
});

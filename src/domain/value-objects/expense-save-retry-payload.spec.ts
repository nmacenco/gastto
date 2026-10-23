// LAYER: Domain / Tests

import { describe, expect, it } from 'vitest';
import {
  isExpenseSaveRetryPayload,
  parseExpenseSaveRetryPayload,
} from './expense-save-retry-payload';

const legacyPayload = {
  expense: {
    extracted: {
      monto: 25,
      moneda: 'EUR',
      categoriaRaw: 'Food',
      fechaRaw: '2026-09-08',
      medioPago: null,
      confianzaCategoria: 'alta',
    },
    rawMessage: 'Lunch 25 EUR',
    resolvedDate: '2026-09-08',
    resolvedCategory: 'Food',
    resolvedCategoryId: 'category-food',
    categoryStatus: 'confirmed',
  },
  failureCode: 'NETWORK_ERROR',
  firstAttemptAt: '2026-09-08T10:00:00.000Z',
  attemptCount: 1,
} as const;

describe('parseExpenseSaveRetryPayload()', () => {
  it('normalizes the nested legacy review', () => {
    expect(parseExpenseSaveRetryPayload(legacyPayload)).toMatchObject({
      actionBinding: null,
      expense: {
        resolvedSubcategory: null,
        resolvedSubcategoryId: null,
        subcategoryStatus: 'none',
        subcategoryEnabled: false,
        extracted: { subcategoriaRaw: null, confianzaSubcategoria: 'nula' },
      },
    });
    expect(isExpenseSaveRetryPayload(legacyPayload)).toBe(true);
  });

  it('accepts a strict presented action binding and rejects malformed binding fields', () => {
    const actionBinding = {
      operationId: 'abcdefghijklmnopqrstuv',
      revision: 1,
      presentedAt: '2026-09-12T10:00:00.000Z',
    };
    expect(parseExpenseSaveRetryPayload({ ...legacyPayload, actionBinding })).toMatchObject({
      actionBinding,
    });
    expect(
      parseExpenseSaveRetryPayload({
        ...legacyPayload,
        actionBinding: { ...actionBinding, extra: true },
      }),
    ).toBeNull();
  });

  it.each([
    null,
    { ...legacyPayload, attemptCount: 2 },
    { ...legacyPayload, firstAttemptAt: 'not-a-date' },
    { ...legacyPayload, failureCode: 'INVALID' },
    { ...legacyPayload, expense: { rawMessage: 'incomplete' } },
  ])('returns null for an invalid envelope or nested review', (payload) => {
    expect(parseExpenseSaveRetryPayload(payload)).toBeNull();
  });
});

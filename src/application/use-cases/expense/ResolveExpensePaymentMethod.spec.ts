import { describe, expect, it, vi } from 'vitest';
import { PaymentMethodCatalog } from '../../../domain/entities/PaymentMethodCatalog';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type { ResolveExpenseSummaryActionUseCase } from './ResolveExpenseSummaryActionUseCase';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { ResolveExpensePaymentMethod } from './ResolveExpensePaymentMethod';

const expected = { revision: '7', currentState: 'EXPENSE_REVIEW', expiry: 'unexpired' as const };
const authorization = {
  kind: 'text' as const,
  receivedAt: '2026-10-26T10:01:00.000Z',
  sourceMessageId: 'message-1',
};
const binding = {
  operationId: 'abcdefghijklmnopqrstuv',
  revision: 2,
  presentedAt: '2026-10-26T10:00:00.000Z',
};
function review(status: 'unresolved' | 'matched' = 'unresolved'): ExpenseReviewPayload {
  return {
    rawMessage: 'Café 12 EUR con Visa',
    extracted: {
      monto: 12,
      moneda: 'EUR',
      categoriaRaw: 'Comida',
      subcategoriaRaw: null,
      fechaRaw: '2026-10-26',
      medioPago: status === 'unresolved' ? 'Mastercard' : 'Visa',
      confianzaCategoria: 'alta',
      confianzaSubcategoria: 'nula',
    },
    resolvedDate: '2026-10-26',
    resolvedCategory: 'Comida',
    resolvedCategoryId: 'category-1',
    categoryStatus: 'confirmed',
    resolvedSubcategory: null,
    resolvedSubcategoryId: null,
    subcategoryStatus: 'none',
    subcategoryEnabled: false,
    paymentMethodSelection:
      status === 'unresolved'
        ? {
            status: 'unresolved',
            sourceConfigId: 'config-1',
            paymentMethodId: null,
            canonicalName: null,
            unresolvedRaw: 'Mastercard',
          }
        : {
            status: 'matched',
            sourceConfigId: 'config-1',
            paymentMethodId: 'visa-id',
            canonicalName: 'Visa',
            unresolvedRaw: null,
          },
    reviewBinding: binding,
  };
}

function setup(payload = review()) {
  const catalog = new PaymentMethodCatalog('config-1', [
    { id: 'visa-id', name: 'Visa', normalizedName: 'visa', isActive: true },
  ]);
  const authorizeReview = vi
    .fn()
    .mockReturnValue({ status: 'authorized', action: 'correct', payload });
  const currentState = vi
    .fn()
    .mockReturnValue({ userId: 'user-1', revision: '7', currentState: 'EXPENSE_REVIEW' });
  const adoptCommittedState = vi.fn();
  const commit = vi.fn().mockImplementation((input: { next: ExpenseReviewPayload }) =>
    Promise.resolve({
      status: 'updated',
      state: {
        userId: 'user-1',
        revision: '8',
        currentState: 'EXPENSE_REVIEW',
        statePayload: input.next,
        enteredAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        updatedAt: new Date(),
      },
    }),
  );
  const useCase = new ResolveExpensePaymentMethod({
    authorization: { authorizeReview } as unknown as ResolveExpenseSummaryActionUseCase,
    transitionState: {
      currentState,
      adoptCommittedState,
    } as unknown as TransitionConversationState,
    catalogRepository: {
      findBySpreadsheetId: vi.fn().mockResolvedValue(catalog),
    },
    commit: { execute: commit },
  });
  return { useCase, authorizeReview, currentState, adoptCommittedState, commit };
}

describe('ResolveExpensePaymentMethod', () => {
  it('selects an existing method and advances the binding before re-presentation', async () => {
    const t = setup();
    const result = await t.useCase.execute({
      userId: 'user-1',
      expected,
      authorization,
      action: { kind: 'select', name: ' VISA ' },
    });
    expect(result).toMatchObject({
      status: 'updated',
      added: false,
      payload: {
        paymentMethodSelection: {
          status: 'matched',
          paymentMethodId: 'visa-id',
          canonicalName: 'Visa',
        },
        reviewBinding: { revision: 3, presentedAt: null },
      },
    });
    expect(t.adoptCommittedState).toHaveBeenCalledWith(expect.objectContaining({ revision: '8' }));
  });

  it('adds only the displayed unknown method, independently of expense confirmation', async () => {
    const t = setup();
    const result = await t.useCase.execute({
      userId: 'user-1',
      expected,
      authorization,
      action: { kind: 'add' },
    });
    expect(result).toMatchObject({
      status: 'updated',
      added: true,
      payload: { paymentMethodSelection: { status: 'matched', canonicalName: 'Mastercard' } },
    });
    expect(t.commit.mock.calls[0]?.[0]).toMatchObject({
      action: { kind: 'add', name: 'Mastercard' },
    });
  });

  it('clears payment text and selection in the same review update', async () => {
    const t = setup();
    const result = await t.useCase.execute({
      userId: 'user-1',
      expected,
      authorization,
      action: { kind: 'clear' },
    });
    expect(result).toMatchObject({
      status: 'updated',
      payload: {
        extracted: { medioPago: null },
        paymentMethodSelection: { status: 'none' },
      },
    });
  });

  it('does not write after a stale authorization or revision', async () => {
    const t = setup();
    t.authorizeReview.mockReturnValueOnce({ status: 'unbound' });
    await expect(
      t.useCase.execute({ userId: 'user-1', expected, authorization, action: { kind: 'add' } }),
    ).resolves.toEqual({ status: 'unbound' });
    t.currentState.mockReturnValueOnce({ revision: '8', currentState: 'EXPENSE_REVIEW' });
    await expect(
      t.useCase.execute({ userId: 'user-1', expected, authorization, action: { kind: 'add' } }),
    ).resolves.toEqual({ status: 'stale' });
    expect(t.commit).not.toHaveBeenCalled();
  });
});

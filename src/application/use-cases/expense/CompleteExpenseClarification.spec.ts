import { describe, expect, it, vi } from 'vitest';
import { ExpenseClarificationState } from '../../../domain/value-objects/expense-clarification-state';
import { CompleteExpenseClarification } from './CompleteExpenseClarification';

const partial = {
  monto: 12,
  moneda: null,
  categoriaRaw: 'café',
  subcategoriaRaw: null,
  fechaRaw: null,
  medioPago: null,
  confianzaCategoria: 'alta' as const,
  confianzaSubcategoria: 'nula' as const,
};

describe('CompleteExpenseClarification', () => {
  it('validates state, retains the original message, and preserves queue progress', async () => {
    const interpret = vi.fn().mockResolvedValue({
      status: 'needs_clarification',
      missingField: 'monto',
    });
    const useCase = new CompleteExpenseClarification({ interpret });
    const state = ExpenseClarificationState.create('moneda', partial, 'Café por 12', 2);

    await useCase.execute({
      userId: 'user-1',
      rawReply: 'euros',
      channel: 'telegram',
      statePayload: state.toPayload(),
    });

    expect(interpret).toHaveBeenCalledWith({
      userId: 'user-1',
      rawMessage: 'Café por 12 euros',
      channel: 'telegram',
      queueRegisteredCount: 2,
    });
  });

  it('rejects an invalid payload before extraction', async () => {
    const interpret = vi.fn();
    const useCase = new CompleteExpenseClarification({ interpret });

    await expect(
      useCase.execute({
        userId: 'user-1',
        rawReply: 'EUR',
        channel: 'telegram',
        statePayload: { missingField: 'moneda' },
      }),
    ).rejects.toThrow();
    expect(interpret).not.toHaveBeenCalled();
  });
});

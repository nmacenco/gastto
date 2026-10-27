import { describe, expect, it } from 'vitest';
import { normalizePaymentMethodSelection } from './payment-method-selection';

describe('payment method selection normalization', () => {
  it('upgrades a legacy review from extracted free text without an ID', () => {
    expect(normalizePaymentMethodSelection(undefined, 'Tarjeta')).toEqual({
      status: 'legacy',
      sourceConfigId: null,
      paymentMethodId: null,
      canonicalName: 'Tarjeta',
      unresolvedRaw: null,
    });
  });
  it('retains an unresolved raw value for explicit resolution', () => {
    expect(
      normalizePaymentMethodSelection(
        {
          status: 'unresolved',
          sourceConfigId: 'config',
          paymentMethodId: null,
          canonicalName: null,
          unresolvedRaw: 'Tarjeta',
        },
        null,
      ).status,
    ).toBe('unresolved');
  });
  it('rejects contradictory selections', () => {
    expect(() =>
      normalizePaymentMethodSelection(
        {
          status: 'matched',
          sourceConfigId: 'config',
          paymentMethodId: null,
          canonicalName: 'Tarjeta',
          unresolvedRaw: null,
        },
        null,
      ),
    ).toThrow();
  });
});

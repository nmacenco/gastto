import { describe, expect, it } from 'vitest';
import { PaymentMethodCatalog } from '../../../domain/entities/PaymentMethodCatalog';
import { ResolvePaymentMethod } from './ResolvePaymentMethod';

const configId = 'config';
const resolve = new ResolvePaymentMethod();

describe('ResolvePaymentMethod', () => {
  it('preserves legacy free text when no catalog is configured', () => {
    expect(
      resolve.execute({ catalog: null, rawValue: '  Tarjeta  ', sourceConfigId: configId }),
    ).toEqual({
      status: 'legacy',
      sourceConfigId: configId,
      paymentMethodId: null,
      canonicalName: 'Tarjeta',
      unresolvedRaw: null,
    });
  });
  it('distinguishes confirmed empty from unconfigured', () => {
    const catalog = new PaymentMethodCatalog(configId);
    expect(resolve.execute({ catalog, rawValue: null, sourceConfigId: configId }).status).toBe(
      'none',
    );
    expect(resolve.execute({ catalog, rawValue: 'Tarjeta', sourceConfigId: configId }).status).toBe(
      'unresolved',
    );
  });
  it('matches exact normalized active names and returns canonical spelling', () => {
    const catalog = new PaymentMethodCatalog(configId);
    const card = catalog.add('Visa débito');
    expect(
      resolve.execute({ catalog, rawValue: ' VISA DÉBITO ', sourceConfigId: configId }),
    ).toEqual({
      status: 'matched',
      sourceConfigId: configId,
      paymentMethodId: card.id,
      canonicalName: 'Visa débito',
      unresolvedRaw: null,
    });
    expect(resolve.execute({ catalog, rawValue: 'tarjeta', sourceConfigId: configId }).status).toBe(
      'unresolved',
    );
  });
  it('rejects a catalog from another destination before any selection', () => {
    expect(() =>
      resolve.execute({
        catalog: new PaymentMethodCatalog('other'),
        rawValue: null,
        sourceConfigId: configId,
      }),
    ).toThrow(/destination mismatch/);
  });
});

import { describe, expect, it } from 'vitest';
import { PaymentMethodCatalog } from './PaymentMethodCatalog';

describe('PaymentMethodCatalog', () => {
  it('normalizes only whitespace and case while retaining display spelling', () => {
    const catalog = new PaymentMethodCatalog('sheet');
    const method = catalog.add('  Débito Visa  ');
    expect(method).toMatchObject({ name: 'Débito Visa', normalizedName: 'débito visa' });
    expect(() => catalog.add(' DÉBITO VISA ')).toThrow();
    expect(catalog.add('Debito Visa').id).not.toBe(method.id);
  });

  it('reactivates an inactive name with its original identity', () => {
    const catalog = new PaymentMethodCatalog('sheet');
    const method = catalog.add('Efectivo');
    catalog.deactivate(method.id);
    expect(catalog.add(' efectivo ').id).toBe(method.id);
  });

  it('preserves the id on rename and reserves inactive names', () => {
    const catalog = new PaymentMethodCatalog('sheet');
    const card = catalog.add('Tarjeta');
    const cash = catalog.add('Efectivo');
    catalog.deactivate(cash.id);
    expect(() => catalog.rename(card.id, 'efectivo')).toThrow(/reserved/);
    expect(catalog.rename(card.id, 'Crédito').id).toBe(card.id);
  });

  it('allows a confirmed empty catalog', () => {
    expect(new PaymentMethodCatalog('sheet').getActive()).toEqual([]);
  });
});

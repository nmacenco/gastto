// LAYER: Application / Tests
// Unit tests for clarification helpers.

import { describe, it, expect } from 'vitest';
import {
  isNewExpenseDuringClarification,
  buildCurrencyOptions,
  formatCurrencyOption,
} from './clarification';

describe('isNewExpenseDuringClarification', () => {
  it('returns true when the message looks like a complete expense sentence', () => {
    expect(isNewExpenseDuringClarification('Pagué 30 euros por el café', 'monto')).toBe(true);
    expect(isNewExpenseDuringClarification('30 ARS', 'moneda')).toBe(false);
  });

  it('returns true for long messages even without a currency token', () => {
    const longMessage = 'Fui al supermercado y compré leche, pan, huevos y algunas cosas más';
    expect(isNewExpenseDuringClarification(longMessage, 'monto')).toBe(true);
  });

  it('returns true for messages with many words', () => {
    expect(
      isNewExpenseDuringClarification(
        'Compré café con leche y dos medialunas en la esquina',
        'monto',
      ),
    ).toBe(true);
  });

  it('returns false for a short numeric or amount+currency answer when amount is missing', () => {
    expect(isNewExpenseDuringClarification('30', 'monto')).toBe(false);
    expect(isNewExpenseDuringClarification('850 pesos', 'monto')).toBe(false);
  });

  it('returns false for a short currency answer when currency is missing', () => {
    expect(isNewExpenseDuringClarification('euros', 'moneda')).toBe(false);
    expect(isNewExpenseDuringClarification('ARS', 'moneda')).toBe(false);
  });

  it('returns false for empty messages', () => {
    expect(isNewExpenseDuringClarification('', 'monto')).toBe(false);
  });
});

describe('buildCurrencyOptions', () => {
  it('starts with the default currency', () => {
    const result = buildCurrencyOptions('EUR', ['USD', 'ARS']);

    expect(result).toEqual(['EUR', 'USD', 'ARS']);
  });

  it('deduplicates recent currencies that match the default', () => {
    const result = buildCurrencyOptions('USD', ['USD', 'EUR', 'USD']);

    expect(result).toEqual(['USD', 'EUR']);
  });

  it('caps the result at 3 options', () => {
    const result = buildCurrencyOptions('ARS', ['EUR', 'USD', 'GBP', 'BRL']);

    expect(result).toHaveLength(3);
    expect(result).toEqual(['ARS', 'EUR', 'USD']);
  });

  it('falls back to recent currencies when there is no default', () => {
    const result = buildCurrencyOptions(null, ['EUR', 'USD']);

    expect(result).toEqual(['EUR', 'USD']);
  });

  it('returns an empty array when no currencies are available', () => {
    const result = buildCurrencyOptions(null, []);

    expect(result).toEqual([]);
  });
});

describe('formatCurrencyOption', () => {
  it('returns a human-readable label for each supported currency', () => {
    expect(formatCurrencyOption('ARS')).toContain('pesos argentinos');
    expect(formatCurrencyOption('EUR')).toContain('euros');
    expect(formatCurrencyOption('USD')).toContain('dólares');
    expect(formatCurrencyOption('MXN')).toContain('pesos mexicanos');
    expect(formatCurrencyOption('GBP')).toContain('libras');
    expect(formatCurrencyOption('BRL')).toContain('reales');
  });
});

// LAYER: Application / Tests
// Unit tests for the deterministic ExtractAmountCurrency fallback service.
// No external dependencies; covers acceptance scenarios from E1-US-03.

import { describe, it, expect } from 'vitest';
import { ExtractAmountCurrency } from './ExtractAmountCurrency';
import {
  isSuccessAmountCurrencyResult,
  isAmountNotFoundResult,
  isCurrencyNotFoundResult,
  isAmbiguousCurrencyResult,
  isInvalidAmountFormatResult,
} from '../../domain/value-objects/AmountCurrencyExtractionResult';
import type { Currency as CurrencyCode } from '../../domain/entities/User';

describe('ExtractAmountCurrency', () => {
  const extractor = new ExtractAmountCurrency();

  function assertSuccess(
    result: ReturnType<ExtractAmountCurrency['execute']>,
    expectedAmount: number,
    expectedCurrency: CurrencyCode,
  ) {
    expect(isSuccessAmountCurrencyResult(result)).toBe(true);
    if (isSuccessAmountCurrencyResult(result)) {
      expect(result.money.amount).toBe(expectedAmount);
      expect(result.money.currency).toBe(expectedCurrency);
    }
  }

  describe('explicit amount and currency', () => {
    it('extracts "Pagué 45,50 EUR en el supermercado" as 45.50 EUR', () => {
      const result = extractor.execute('Pagué 45,50 EUR en el supermercado', null);
      assertSuccess(result, 45.5, 'EUR');
    });

    it('extracts "120 USD" as 120 USD', () => {
      const result = extractor.execute('120 USD', null);
      assertSuccess(result, 120, 'USD');
    });

    it('extracts "100 ARS" as 100 ARS', () => {
      const result = extractor.execute('100 ARS', null);
      assertSuccess(result, 100, 'ARS');
    });
  });

  describe('currency symbols', () => {
    it('extracts "€50" as 50 EUR', () => {
      const result = extractor.execute('€50', null);
      assertSuccess(result, 50, 'EUR');
    });

    it('extracts "£100" as 100 GBP', () => {
      const result = extractor.execute('£100', null);
      assertSuccess(result, 100, 'GBP');
    });

    it('extracts "A$500" as 500 ARS', () => {
      const result = extractor.execute('A$500', null);
      assertSuccess(result, 500, 'ARS');
    });

    it('extracts "R$250" as 250 BRL', () => {
      const result = extractor.execute('R$250', null);
      assertSuccess(result, 250, 'BRL');
    });

    it('resolves $ with default currency USD', () => {
      const result = extractor.execute('Gasté $1.200 en el taxi', 'USD');
      assertSuccess(result, 1200, 'USD');
    });

    it('resolves $ with default currency ARS', () => {
      const result = extractor.execute('Gasté $1.200 en el taxi', 'ARS');
      assertSuccess(result, 1200, 'ARS');
    });
  });

  describe('thousands and decimal separators', () => {
    it('parses 1.200 as 1200 (thousands separator)', () => {
      const result = extractor.execute('Gasté $1.200 en el taxi', 'USD');
      assertSuccess(result, 1200, 'USD');
    });

    it('parses 8.500,00 as 8500.00 (comma decimal)', () => {
      const result = extractor.execute('Cargué nafta por 8.500,00 pesos', 'ARS');
      assertSuccess(result, 8500.0, 'ARS');
    });

    it('parses 1,234.56 as 1234.56 (comma thousands, dot decimal)', () => {
      const result = extractor.execute('Paid 1,234.56 USD', 'USD');
      assertSuccess(result, 1234.56, 'USD');
    });

    it('parses 1.234,56 as 1234.56 (dot thousands, comma decimal)', () => {
      const result = extractor.execute('Pagado 1.234,56 EUR', 'EUR');
      assertSuccess(result, 1234.56, 'EUR');
    });

    it('parses 45,50 as 45.50 (comma decimal)', () => {
      const result = extractor.execute('Pagué 45,50 EUR en el supermercado', null);
      assertSuccess(result, 45.5, 'EUR');
    });

    it('parses 45.50 as 45.50 (dot decimal)', () => {
      const result = extractor.execute('Paid 45.50 USD', null);
      assertSuccess(result, 45.5, 'USD');
    });
  });

  describe('currency words', () => {
    it('extracts "euros" as EUR', () => {
      const result = extractor.execute('Gasté 100 euros', null);
      assertSuccess(result, 100, 'EUR');
    });

    it('extracts "libras" as GBP', () => {
      const result = extractor.execute('Gasté 100 libras', null);
      assertSuccess(result, 100, 'GBP');
    });

    it('extracts "reales" as BRL', () => {
      const result = extractor.execute('Gasté 100 reales', null);
      assertSuccess(result, 100, 'BRL');
    });

    it('uses default currency when text says "pesos" without default matching', () => {
      const result = extractor.execute('Cargué nafta por 1000 pesos', 'MXN');
      assertSuccess(result, 1000, 'MXN');
    });
  });

  describe('ambiguous currency', () => {
    it('returns ambiguous-currency when $ is used without default currency', () => {
      const result = extractor.execute('Gasté $1.200 en el taxi', null);
      expect(isAmbiguousCurrencyResult(result)).toBe(true);
      if (isAmbiguousCurrencyResult(result)) {
        expect(result.candidates.map((c) => c.code)).toEqual(['USD', 'ARS', 'MXN', 'BRL']);
      }
    });

    it('returns ambiguous-currency for "pesos" without default currency', () => {
      const result = extractor.execute('Gasté 1000 pesos', null);
      expect(isAmbiguousCurrencyResult(result)).toBe(true);
      if (isAmbiguousCurrencyResult(result)) {
        expect(result.candidates.map((c) => c.code)).toEqual(['ARS', 'MXN']);
      }
    });
  });

  describe('missing fields', () => {
    it('returns currency-not-found when amount exists but no currency and no default', () => {
      const result = extractor.execute('Pagué 30 por el café', null);
      expect(isCurrencyNotFoundResult(result)).toBe(true);
    });

    it('uses default currency when amount exists but no currency is mentioned', () => {
      const result = extractor.execute('Pagué 30 por el café', 'EUR');
      assertSuccess(result, 30, 'EUR');
    });

    it('returns amount-not-found when no number is present', () => {
      const result = extractor.execute('Fui al supermercado', null);
      expect(isAmountNotFoundResult(result)).toBe(true);
    });
  });

  describe('zero amount', () => {
    it('allows amount 0 as valid', () => {
      const result = extractor.execute('Gasté 0 pesos en algo', 'ARS');
      assertSuccess(result, 0, 'ARS');
    });
  });

  describe('invalid amount format', () => {
    it('returns invalid-amount-format for malformed numbers', () => {
      const result = extractor.execute('Gasté 12.34.56 EUR', null);
      expect(isInvalidAmountFormatResult(result)).toBe(true);
      if (isInvalidAmountFormatResult(result)) {
        expect(result.rawValue).toBe('12.34.56');
      }
    });
  });

  describe('amount selection near currency', () => {
    it('picks the amount closest to the currency marker', () => {
      const result = extractor.execute('Viaje 10 y 20 EUR', null);
      assertSuccess(result, 20, 'EUR');
    });
  });

  describe('zero amount formats', () => {
    it.each([
      { text: 'Gasté 0 pesos', defaultCurrency: 'ARS' as const, expectedCurrency: 'ARS' as const },
      { text: 'Gasté 0.00 EUR', defaultCurrency: null, expectedCurrency: 'EUR' as const },
      { text: 'Gasté 0,00 EUR', defaultCurrency: null, expectedCurrency: 'EUR' as const },
    ])(
      'treats "$text" as 0 $expectedCurrency',
      ({ text, defaultCurrency, expectedCurrency }) => {
        const result = extractor.execute(text, defaultCurrency);
        assertSuccess(result, 0, expectedCurrency);
      },
    );
  });

  describe('ambiguous $ with default currency outside candidate list', () => {
    it('returns ambiguous-currency when default currency is not a dollar candidate', () => {
      const result = extractor.execute('Gasté $1.200 en el taxi', 'GBP');
      expect(isAmbiguousCurrencyResult(result)).toBe(true);
      if (isAmbiguousCurrencyResult(result)) {
        expect(result.candidates.map((c) => c.code)).toEqual(['USD', 'ARS', 'MXN', 'BRL']);
      }
    });
  });

  describe('missing amount and missing currency combined', () => {
    it('returns amount-not-found when no number and no currency are present', () => {
      const result = extractor.execute('Fui al supermercado', null);
      expect(isAmountNotFoundResult(result)).toBe(true);
    });
  });

  describe('invalid amount format edge cases', () => {
    it.each([
      'Gasté 12,34,56 EUR',
      'Gasté 1.234.56 EUR',
      'Gasté 1,2,3 EUR',
    ])('returns invalid-amount-format for "%s"', (text) => {
      const result = extractor.execute(text, null);
      expect(isInvalidAmountFormatResult(result)).toBe(true);
    });
  });
});

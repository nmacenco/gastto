// LAYER: Domain / Tests
// Unit tests for the AmountCurrencyExtractionResult discriminated union.

import { describe, it, expect } from 'vitest';
import {
  AmountCurrencyExtractionResult,
  isSuccessAmountCurrencyResult,
  isAmountNotFoundResult,
  isCurrencyNotFoundResult,
  isAmbiguousCurrencyResult,
  isInvalidAmountFormatResult,
} from './AmountCurrencyExtractionResult';
import { Money } from './Money';
import { Currency } from './Currency';

describe('AmountCurrencyExtractionResult', () => {
  describe('factory constructors', () => {
    it('creates a success result with Money', () => {
      const money = new Money(123.45, 'EUR');
      const result = AmountCurrencyExtractionResult.success(money);
      expect(result).toEqual({ kind: 'success', money });
    });

    it('creates an amount-not-found result', () => {
      const result = AmountCurrencyExtractionResult.amountNotFound();
      expect(result).toEqual({ kind: 'amount-not-found' });
    });

    it('creates a currency-not-found result', () => {
      const result = AmountCurrencyExtractionResult.currencyNotFound();
      expect(result).toEqual({ kind: 'currency-not-found' });
    });

    it('creates an ambiguous-currency result with candidates', () => {
      const candidates = [new Currency('USD'), new Currency('ARS')];
      const result = AmountCurrencyExtractionResult.ambiguousCurrency(candidates);
      expect(result).toEqual({ kind: 'ambiguous-currency', candidates });
    });

    it('creates an invalid-amount-format result with the raw value', () => {
      const result = AmountCurrencyExtractionResult.invalidAmountFormat('12.34.56');
      expect(result).toEqual({ kind: 'invalid-amount-format', rawValue: '12.34.56' });
    });
  });

  describe('type guards', () => {
    it('narrows success correctly', () => {
      const result = AmountCurrencyExtractionResult.success(new Money(10, 'USD'));
      expect(isSuccessAmountCurrencyResult(result)).toBe(true);
      expect(isAmountNotFoundResult(result)).toBe(false);
      expect(isCurrencyNotFoundResult(result)).toBe(false);
      expect(isAmbiguousCurrencyResult(result)).toBe(false);
      expect(isInvalidAmountFormatResult(result)).toBe(false);
    });

    it('narrows amount-not-found correctly', () => {
      const result = AmountCurrencyExtractionResult.amountNotFound();
      expect(isAmountNotFoundResult(result)).toBe(true);
      expect(isSuccessAmountCurrencyResult(result)).toBe(false);
    });

    it('narrows currency-not-found correctly', () => {
      const result = AmountCurrencyExtractionResult.currencyNotFound();
      expect(isCurrencyNotFoundResult(result)).toBe(true);
      expect(isSuccessAmountCurrencyResult(result)).toBe(false);
    });

    it('narrows ambiguous-currency correctly', () => {
      const result = AmountCurrencyExtractionResult.ambiguousCurrency([new Currency('USD')]);
      expect(isAmbiguousCurrencyResult(result)).toBe(true);
      expect(isSuccessAmountCurrencyResult(result)).toBe(false);
    });

    it('narrows invalid-amount-format correctly', () => {
      const result = AmountCurrencyExtractionResult.invalidAmountFormat('abc');
      expect(isInvalidAmountFormatResult(result)).toBe(true);
      expect(isSuccessAmountCurrencyResult(result)).toBe(false);
    });
  });

  describe('discriminated union exhaustiveness', () => {
    it('can be narrowed in a switch statement', () => {
      function getLabel(result: AmountCurrencyExtractionResult): string {
        switch (result.kind) {
          case 'success':
            return `success:${result.money.amount}:${result.money.currency}`;
          case 'amount-not-found':
            return 'amount-not-found';
          case 'currency-not-found':
            return 'currency-not-found';
          case 'ambiguous-currency':
            return `ambiguous-currency:${result.candidates.length}`;
          case 'invalid-amount-format':
            return `invalid-amount-format:${result.rawValue}`;
          /* istanbul ignore next */
          default:
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            return `unknown: ${result}`;
        }
      }

      expect(getLabel(AmountCurrencyExtractionResult.success(new Money(10, 'USD')))).toBe(
        'success:10:USD',
      );
      expect(getLabel(AmountCurrencyExtractionResult.amountNotFound())).toBe('amount-not-found');
      expect(getLabel(AmountCurrencyExtractionResult.currencyNotFound())).toBe(
        'currency-not-found',
      );
      expect(
        getLabel(AmountCurrencyExtractionResult.ambiguousCurrency([new Currency('EUR')])),
      ).toBe('ambiguous-currency:1');
      expect(getLabel(AmountCurrencyExtractionResult.invalidAmountFormat('x'))).toBe(
        'invalid-amount-format:x',
      );
    });
  });
});

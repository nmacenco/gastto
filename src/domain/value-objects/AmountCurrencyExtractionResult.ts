// LAYER: Domain
// Discriminated union representing the outcome of deterministic amount/currency extraction.
// Used as the return type for the fallback extractor service.

import type { Money } from './Money';
import type { Currency } from './Currency';

export type AmountCurrencyExtractionResult =
  | { readonly kind: 'success'; readonly money: Money }
  | { readonly kind: 'amount-not-found' }
  | { readonly kind: 'currency-not-found' }
  | { readonly kind: 'ambiguous-currency'; readonly candidates: readonly Currency[] }
  | { readonly kind: 'invalid-amount-format'; readonly rawValue: string };

export function isSuccessAmountCurrencyResult(
  result: AmountCurrencyExtractionResult,
): result is { readonly kind: 'success'; readonly money: Money } {
  return result.kind === 'success';
}

export function isAmountNotFoundResult(
  result: AmountCurrencyExtractionResult,
): result is { readonly kind: 'amount-not-found' } {
  return result.kind === 'amount-not-found';
}

export function isCurrencyNotFoundResult(
  result: AmountCurrencyExtractionResult,
): result is { readonly kind: 'currency-not-found' } {
  return result.kind === 'currency-not-found';
}

export function isAmbiguousCurrencyResult(
  result: AmountCurrencyExtractionResult,
): result is { readonly kind: 'ambiguous-currency'; readonly candidates: readonly Currency[] } {
  return result.kind === 'ambiguous-currency';
}

export function isInvalidAmountFormatResult(
  result: AmountCurrencyExtractionResult,
): result is { readonly kind: 'invalid-amount-format'; readonly rawValue: string } {
  return result.kind === 'invalid-amount-format';
}

export const AmountCurrencyExtractionResult = {
  success(money: Money): AmountCurrencyExtractionResult {
    return { kind: 'success', money };
  },

  amountNotFound(): AmountCurrencyExtractionResult {
    return { kind: 'amount-not-found' };
  },

  currencyNotFound(): AmountCurrencyExtractionResult {
    return { kind: 'currency-not-found' };
  },

  ambiguousCurrency(candidates: readonly Currency[]): AmountCurrencyExtractionResult {
    return { kind: 'ambiguous-currency', candidates };
  },

  invalidAmountFormat(rawValue: string): AmountCurrencyExtractionResult {
    return { kind: 'invalid-amount-format', rawValue };
  },
};

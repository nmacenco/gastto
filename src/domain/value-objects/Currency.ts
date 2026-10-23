// LAYER: Domain
// Immutable value object that validates and normalizes a currency ISO code or symbol.
// Ambiguous symbols (e.g. '$') are rejected; callers must resolve them with context first.

import type { Currency as CurrencyCode } from '../entities/User';
import { DomainValidationError } from '../errors/DomainValidationError';

const SUPPORTED_CODES: readonly CurrencyCode[] = ['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL'];

const CODE_TO_CURRENCY = Object.freeze(
  Object.fromEntries(SUPPORTED_CODES.map((code) => [code, code])),
) as Readonly<Record<CurrencyCode, CurrencyCode>>;

const SYMBOL_TO_CURRENCY = Object.freeze({
  '€': 'EUR',
  '£': 'GBP',
}) as Readonly<Record<string, CurrencyCode>>;

function isCurrencyCode(value: string): value is CurrencyCode {
  return SUPPORTED_CODES.includes(value as CurrencyCode);
}

export class Currency {
  readonly code: CurrencyCode;

  constructor(value: string) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new DomainValidationError('Currency value cannot be empty');
    }

    const upper = trimmed.toUpperCase();
    if (isCurrencyCode(upper) && CODE_TO_CURRENCY[upper]) {
      this.code = CODE_TO_CURRENCY[upper];
      Object.freeze(this);
      return;
    }

    const normalizedSymbol = trimmed.normalize('NFC');
    if (SYMBOL_TO_CURRENCY[normalizedSymbol]) {
      this.code = SYMBOL_TO_CURRENCY[normalizedSymbol];
      Object.freeze(this);
      return;
    }

    throw new DomainValidationError(`Unsupported or ambiguous currency: ${value}`);
  }

  equals(other: Currency): boolean {
    return this.code === other.code;
  }
}

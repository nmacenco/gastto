// LAYER: Application
// Deterministic fallback extractor for amount and currency from free-text messages.
// Runs only when the LLM does not detect those fields; preserves LLM as primary path (ADR-002).

import type { Currency as CurrencyCode } from '../../domain/entities/User';
import { Currency } from '../../domain/value-objects/Currency';
import { Money } from '../../domain/value-objects/Money';
import {
  AmountCurrencyExtractionResult,
  type AmountCurrencyExtractionResult as Result,
} from '../../domain/value-objects/AmountCurrencyExtractionResult';

type ResolvedCurrency = { readonly kind: 'resolved'; readonly code: CurrencyCode };
type AmbiguousCurrency = { readonly kind: 'ambiguous'; readonly candidates: readonly Currency[] };
type CurrencyResolution = ResolvedCurrency | AmbiguousCurrency | null;

interface AmountMatch {
  readonly raw: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

interface CurrencyMatch {
  readonly code: CurrencyCode | null;
  readonly candidates: readonly CurrencyCode[];
  readonly startIndex: number;
  readonly endIndex: number;
}

const SUPPORTED_CODES: readonly CurrencyCode[] = ['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL'];

const CODE_WORD_TO_CURRENCY: Readonly<Record<string, CurrencyCode>> = {
  EUR: 'EUR',
  EURO: 'EUR',
  EUROS: 'EUR',
  GBP: 'GBP',
  LIBRA: 'GBP',
  LIBRAS: 'GBP',
  POUND: 'GBP',
  POUNDS: 'GBP',
  BRL: 'BRL',
  REAL: 'BRL',
  REALES: 'BRL',
};

const AMBIGUOUS_WORD_TO_CANDIDATES: Readonly<Record<string, readonly CurrencyCode[]>> = {
  PESOS: ['ARS', 'MXN'],
  PESO: ['ARS', 'MXN'],
  DOLAR: ['USD'],
  DOLARES: ['USD'],
  DOLLAR: ['USD'],
  DOLLARS: ['USD'],
};

const AMBIGUOUS_DOLLAR_CANDIDATES: readonly CurrencyCode[] = ['USD', 'ARS', 'MXN', 'BRL'];

// Matches numeric tokens including thousands/decimal separators.
// The extractor validates the token later; this regex is intentionally greedy
// so malformed multi-separator inputs can be rejected.
const AMOUNT_REGEX = /\d+(?:[.,]\d+)*/g;

// Multi-char symbols must be listed before single-char ones so the longer match wins.
const SYMBOL_REGEX = /US\$|U\$S|A\$|R\$|M\$N|[\$€£]/gi;

const ISO_CODE_REGEX = new RegExp(`\\b(${SUPPORTED_CODES.join('|')})\\b`, 'gi');

const WORD_REGEX = new RegExp(
  `\\b(${Object.keys(CODE_WORD_TO_CURRENCY).join('|')}|${Object.keys(AMBIGUOUS_WORD_TO_CANDIDATES).join('|')})\\b`,
  'gi',
);

function toCurrencyCodes(candidates: readonly CurrencyCode[]): readonly Currency[] {
  return candidates.map((code) => new Currency(code));
}

export class ExtractAmountCurrency {
  execute(text: string, defaultCurrency: CurrencyCode | null): Result {
    const normalizedText = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const amountMatches = this.findAmounts(normalizedText);
    const currencyMatches = this.findCurrencies(normalizedText);

    if (amountMatches.length === 0) {
      return AmountCurrencyExtractionResult.amountNotFound();
    }

    const bestAmount = this.selectBestAmount(amountMatches, currencyMatches);
    const parsedAmount = this.parseAmount(bestAmount.raw);
    if (parsedAmount === null) {
      return AmountCurrencyExtractionResult.invalidAmountFormat(bestAmount.raw);
    }

    const currencyResolution = this.resolveCurrency(currencyMatches, defaultCurrency);
    if (currencyResolution === null) {
      return AmountCurrencyExtractionResult.currencyNotFound();
    }

    if (currencyResolution.kind === 'ambiguous') {
      return AmountCurrencyExtractionResult.ambiguousCurrency(currencyResolution.candidates);
    }

    const money = new Money(parsedAmount, currencyResolution.code);
    return AmountCurrencyExtractionResult.success(money);
  }

  private findAmounts(text: string): AmountMatch[] {
    const matches: AmountMatch[] = [];
    let match: RegExpExecArray | null;
    AMOUNT_REGEX.lastIndex = 0;
    while ((match = AMOUNT_REGEX.exec(text)) !== null) {
      matches.push({
        raw: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
    return matches;
  }

  private findCurrencies(text: string): CurrencyMatch[] {
    const matches: CurrencyMatch[] = [];

    this.collectSymbolMatches(text, matches);
    this.collectCodeMatches(text, matches);
    this.collectWordMatches(text, matches);

    return matches.sort((a, b) => a.startIndex - b.startIndex);
  }

  private collectSymbolMatches(text: string, matches: CurrencyMatch[]): void {
    let match: RegExpExecArray | null;
    SYMBOL_REGEX.lastIndex = 0;
    while ((match = SYMBOL_REGEX.exec(text)) !== null) {
      const symbol = match[0].toUpperCase();
      if (symbol === '€') {
        matches.push({
          code: 'EUR',
          candidates: [],
          startIndex: match.index,
          endIndex: match.index + 1,
        });
      } else if (symbol === '£') {
        matches.push({
          code: 'GBP',
          candidates: [],
          startIndex: match.index,
          endIndex: match.index + 1,
        });
      } else if (symbol === 'A$') {
        matches.push({
          code: 'ARS',
          candidates: [],
          startIndex: match.index,
          endIndex: match.index + 2,
        });
      } else if (symbol === 'R$') {
        matches.push({
          code: 'BRL',
          candidates: [],
          startIndex: match.index,
          endIndex: match.index + 2,
        });
      } else {
        // $, US$, U$S, M$N — ambiguous dollar-like symbols.
        matches.push({
          code: null,
          candidates: AMBIGUOUS_DOLLAR_CANDIDATES,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      }
    }
  }

  private collectCodeMatches(text: string, matches: CurrencyMatch[]): void {
    let match: RegExpExecArray | null;
    ISO_CODE_REGEX.lastIndex = 0;
    while ((match = ISO_CODE_REGEX.exec(text)) !== null) {
      const code = match[1]!.toUpperCase() as CurrencyCode;
      matches.push({
        code,
        candidates: [],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  private collectWordMatches(text: string, matches: CurrencyMatch[]): void {
    let match: RegExpExecArray | null;
    WORD_REGEX.lastIndex = 0;
    while ((match = WORD_REGEX.exec(text)) !== null) {
      const word = match[1]!.toUpperCase();
      const code = CODE_WORD_TO_CURRENCY[word];
      if (code) {
        matches.push({
          code,
          candidates: [],
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      } else {
        const candidates = AMBIGUOUS_WORD_TO_CANDIDATES[word];
        if (candidates) {
          matches.push({
            code: null,
            candidates,
            startIndex: match.index,
            endIndex: match.index + match[0].length,
          });
        }
      }
    }
  }

  private selectBestAmount(
    amountMatches: AmountMatch[],
    currencyMatches: CurrencyMatch[],
  ): AmountMatch {
    if (currencyMatches.length === 0 || amountMatches.length === 1) {
      return amountMatches[0]!;
    }

    let best = amountMatches[0]!;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const amount of amountMatches) {
      for (const currency of currencyMatches) {
        const distance = Math.min(
          Math.abs(amount.startIndex - currency.endIndex),
          Math.abs(currency.startIndex - amount.endIndex),
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          best = amount;
        }
      }
    }

    return best;
  }

  private resolveCurrency(
    currencyMatches: CurrencyMatch[],
    defaultCurrency: CurrencyCode | null,
  ): CurrencyResolution {
    if (currencyMatches.length === 0) {
      if (defaultCurrency) {
        return { kind: 'resolved', code: defaultCurrency };
      }
      return null;
    }

    const first = currencyMatches[0]!;
    if (first.code) {
      return { kind: 'resolved', code: first.code };
    }

    if (defaultCurrency && first.candidates.includes(defaultCurrency)) {
      return { kind: 'resolved', code: defaultCurrency };
    }

    return { kind: 'ambiguous', candidates: toCurrencyCodes(first.candidates) };
  }

  private parseAmount(raw: string): number | null {
    const dotCount = raw.split('.').length - 1;
    const commaCount = raw.split(',').length - 1;

    if (dotCount > 1 || commaCount > 1) {
      return null;
    }

    if (dotCount === 0 && commaCount === 0) {
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    }

    if (dotCount === 1 && commaCount === 1) {
      const lastDot = raw.lastIndexOf('.');
      const lastComma = raw.lastIndexOf(',');
      const decimalSeparator = lastComma > lastDot ? ',' : '.';
      const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
      const normalized = raw.replaceAll(thousandsSeparator, '').replace(decimalSeparator, '.');
      const value = Number(normalized);
      return Number.isFinite(value) ? value : null;
    }

    const separator = dotCount === 1 ? '.' : ',';
    const lastIndex = raw.lastIndexOf(separator);
    const integerPart = raw.slice(0, lastIndex);
    const fractionalPart = raw.slice(lastIndex + 1);

    if (fractionalPart.length === 0) {
      return null;
    }

    if (fractionalPart.length === 3 && integerPart.length >= 1) {
      const normalized = integerPart + fractionalPart;
      const value = Number(normalized);
      return Number.isFinite(value) ? value : null;
    }

    if (fractionalPart.length > 2) {
      return null;
    }

    const normalized = raw.replace(separator, '.');
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }
}

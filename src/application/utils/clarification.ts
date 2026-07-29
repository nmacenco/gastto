// LAYER: Application
// Helpers for the expense clarification flow (E1-US-05).
// Keeps interruption detection and reformulation logic testable and
// independent of the messaging channel.

import type { Currency } from '../../domain/entities/User';
import type { MissingClarificationField } from '../../domain/value-objects/expense-clarification-state';

const CURRENCY_KEYWORDS: Record<Currency, string[]> = {
  ARS: ['ars', 'pesos', 'peso', '$'],
  EUR: ['eur', 'euros', 'euro', '€'],
  USD: ['usd', 'dólares', 'dolares', 'dólar', 'dolar', '$'],
  MXN: ['mxn', 'pesos mexicanos', '$'],
  GBP: ['gbp', 'libras', 'libra', '£'],
  BRL: ['brl', 'reales', 'real', 'r$'],
};

const CURRENCY_NAMES: Record<Currency, string> = {
  ARS: 'pesos argentinos (ARS)',
  EUR: 'euros (EUR)',
  USD: 'dólares (USD)',
  MXN: 'pesos mexicanos (MXN)',
  GBP: 'libras esterlinas (GBP)',
  BRL: 'reales brasileños (BRL)',
};

const AMOUNT_PATTERN = /\d+(?:[.,]\d+)?/;
const EXPENSE_VERBS = [
  'pagué',
  'pague',
  'gasté',
  'gaste',
  'compré',
  'compre',
  'fui',
  'voy',
  'di',
  'pago',
  'gasto',
  'pagar',
  'gastar',
  'comprar',
];

/**
 * Detects whether a message received while in EXPENSE_CLARIFYING state is a
 * fresh expense message rather than an answer to the current clarification
 * question.
 *
 * Heuristic:
 * - If the message contains both an amount-like token and a currency-like token
 *   and looks like a full sentence (more than 3 words or contains an expense verb),
 *   it is probably a new expense.
 * - If the message is long (>50 chars) or has many words (>5), it is unlikely
 *   to be a short clarification answer.
 * - Otherwise, treat it as a clarification answer.
 */
export function isNewExpenseDuringClarification(
  rawMessage: string,
  _missingField: MissingClarificationField,
): boolean {
  const normalized = rawMessage.toLowerCase().trim();
  if (normalized.length === 0) return false;

  const hasAmount = AMOUNT_PATTERN.test(normalized);
  const hasCurrency = hasCurrencyToken(normalized);
  const hasExpenseVerb = EXPENSE_VERBS.some((verb) => normalized.includes(verb));
  const words = normalized.split(/\s+/).filter((w) => w.length > 0);

  if (hasAmount && hasCurrency && (words.length > 3 || hasExpenseVerb)) return true;
  if (normalized.length > 50) return true;
  if (words.length > 5) return true;

  return false;
}

function hasCurrencyToken(message: string): boolean {
  for (const tokens of Object.values(CURRENCY_KEYWORDS)) {
    for (const token of tokens) {
      if (message.includes(token)) return true;
    }
  }
  return false;
}

/**
 * Builds a deduplicated list of currency options for a reformulated
 * clarification question. Combines the user's default currency with recently
 * used currencies, preserving order and capping at 3 options.
 */
export function buildCurrencyOptions(
  defaultCurrency: Currency | null,
  recentCurrencies: Currency[],
): Currency[] {
  const options: Currency[] = [];

  if (defaultCurrency) {
    options.push(defaultCurrency);
  }

  for (const currency of recentCurrencies) {
    if (!options.includes(currency)) {
      options.push(currency);
    }
  }

  return options.slice(0, 3);
}

/**
 * Formats a currency code as a human-readable option for the reformulated
 * clarification question.
 */
export function formatCurrencyOption(currency: Currency): string {
  return CURRENCY_NAMES[currency] ?? currency;
}

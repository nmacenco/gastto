// LAYER: Domain
// Free-text message intent value object.
// Classifies incoming free-text messages before interpretation.

export type ExpenseLikeIntent = {
  readonly kind: 'expense-like';
};

export type NonFinancialIntent = {
  readonly kind: 'non-financial';
};

export type TooLongIntent = {
  readonly kind: 'too-long';
};

export type FreeTextIntent = ExpenseLikeIntent | NonFinancialIntent | TooLongIntent;

const TOO_LONG_THRESHOLD = 500;

const CURRENCY_SYMBOLS = /[\$€£]/;

const CURRENCY_WORDS = /\b(euros?|dolares?|pesos?|dollars?|euro?|yen?|yuan?|rublo?s?)\b/i;

const EXPENSE_VERBS =
  /pagado|pague|gaste|gasto|compre|compra|compro|paid|spent|spend|bought|buy|ate|eat|drank|drink/i;

const NUMERIC_AMOUNT = /\d+/;
const COMBINING_DIACRITICS = /[\u0300-\u036f]/g;

function looksLikeExpense(text: string): boolean {
  const normalizedText = text.normalize('NFD').replace(COMBINING_DIACRITICS, '');

  return (
    NUMERIC_AMOUNT.test(normalizedText) ||
    CURRENCY_SYMBOLS.test(normalizedText) ||
    CURRENCY_WORDS.test(normalizedText) ||
    EXPENSE_VERBS.test(normalizedText)
  );
}

export const FreeTextIntent = {
  fromText(text: string): FreeTextIntent {
    if (text.length > TOO_LONG_THRESHOLD) {
      return { kind: 'too-long' };
    }
    if (looksLikeExpense(text)) {
      return { kind: 'expense-like' };
    }
    return { kind: 'non-financial' };
  },

  expenseLike(): ExpenseLikeIntent {
    return { kind: 'expense-like' };
  },

  nonFinancial(): NonFinancialIntent {
    return { kind: 'non-financial' };
  },

  tooLong(): TooLongIntent {
    return { kind: 'too-long' };
  },
};

export function isExpenseLikeIntent(intent: FreeTextIntent): intent is ExpenseLikeIntent {
  return intent.kind === 'expense-like';
}

export function isNonFinancialIntent(intent: FreeTextIntent): intent is NonFinancialIntent {
  return intent.kind === 'non-financial';
}

export function isTooLongIntent(intent: FreeTextIntent): intent is TooLongIntent {
  return intent.kind === 'too-long';
}

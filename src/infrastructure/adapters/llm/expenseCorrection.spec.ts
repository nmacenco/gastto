import { describe, expect, it } from 'vitest';
import {
  buildCorrectionSystemPrompt,
  ExpenseCorrectionSuggestionSchema,
  toExpenseCorrectionSuggestion,
} from './expenseCorrection';

const unchanged = {
  intent: 'correction' as const,
  changed_fields: ['medio_pago' as const],
  monto: null,
  moneda: null,
  categoria_raw: null,
  subcategoria_raw: null,
  fecha_raw: null,
};

describe('payment correction contract', () => {
  it('accepts explicit clearing and keeps it distinct from an omitted legacy field', () => {
    const clear = ExpenseCorrectionSuggestionSchema.parse({ ...unchanged, medio_pago: null });
    expect(toExpenseCorrectionSuggestion(clear)).toMatchObject({
      changedFields: ['medio_pago'],
      medioPago: null,
    });
    const old = ExpenseCorrectionSuggestionSchema.parse({
      ...unchanged,
      changed_fields: ['monto'],
      monto: 15,
    });
    expect(toExpenseCorrectionSuggestion(old)).not.toHaveProperty('medioPago');
  });

  it('asks the provider to preserve payment text and reject card guesses', () => {
    const prompt = buildCorrectionSystemPrompt();
    expect(prompt).toContain('conservar el texto explícito');
    expect(prompt).toContain('no identifica una tarjeta específica');
  });
});

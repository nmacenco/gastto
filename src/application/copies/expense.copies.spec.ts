// LAYER: Application / Tests
// Unit tests for expense copy functions.

import { describe, it, expect } from 'vitest';
import { expenseCopies } from './expense.copies';

describe('expenseCopies', () => {
  describe('clarificationInterrupted', () => {
    it('returns a cancellation notice for the interrupted registration', () => {
      const result = expenseCopies.clarificationInterrupted();

      expect(result).toContain('registro anterior fue cancelado');
      expect(result).toContain('Procesando el nuevo gasto');
    });
  });

  describe('expenseCorrectionPrompt', () => {
    it('includes natural-language examples and mentions multi-field corrections', () => {
      const result = expenseCopies.expenseCorrectionPrompt();

      expect(result).toContain('no, fueron 15');
      expect(result).toContain('ponlo en transporte');
      expect(result).toContain('fue ayer');
      expect(result).toContain('varios campos en un solo mensaje');
    });
  });

  describe('correctionApplied', () => {
    it('returns a confirmation for amount correction', () => {
      const result = expenseCopies.correctionApplied('monto', '15 EUR');

      expect(result).toContain('Monto');
      expect(result).toContain('15 EUR');
    });

    it('returns a confirmation for category correction', () => {
      const result = expenseCopies.correctionApplied('categoria', 'Transporte');

      expect(result).toContain('Categoría');
      expect(result).toContain('Transporte');
    });
  });

  describe('correctionCycleLimitReached', () => {
    it('offers confirm or cancel', () => {
      const result = expenseCopies.correctionCycleLimitReached();

      expect(result).toContain('límite de correcciones');
      expect(result).toContain('Confirmamos');
      expect(result).toContain('cancelamos');
    });
  });

  describe('correctionHighAmountConfirmation', () => {
    it('requests explicit confirmation for a high amount', () => {
      const result = expenseCopies.correctionHighAmountConfirmation();

      expect(result).toContain('inusualmente alto');
      expect(result).toContain('Confirmamos');
    });
  });

  describe('clarificationReformulation', () => {
    it('returns the default question when no options are provided', () => {
      const result = expenseCopies.clarificationReformulation([]);

      expect(result).toBe('¿En qué moneda fue ese gasto?');
    });

    it('returns a single-option question', () => {
      const result = expenseCopies.clarificationReformulation(['pesos argentinos (ARS)']);

      expect(result).toBe('¿El gasto fue en pesos argentinos (ARS)?');
    });

    it('returns a two-option question joined by "o"', () => {
      const result = expenseCopies.clarificationReformulation([
        'pesos argentinos (ARS)',
        'euros (EUR)',
      ]);

      expect(result).toBe('¿El gasto fue en pesos argentinos (ARS) o euros (EUR)?');
    });

    it('returns a multi-option question with comma-separated preceding options', () => {
      const result = expenseCopies.clarificationReformulation([
        'pesos argentinos (ARS)',
        'euros (EUR)',
        'dólares (USD)',
      ]);

      expect(result).toBe('¿El gasto fue en pesos argentinos (ARS), euros (EUR) o dólares (USD)?');
    });
  });
});

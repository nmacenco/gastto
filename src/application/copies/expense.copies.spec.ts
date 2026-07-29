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

// LAYER: Application / Tests
// Unit tests for expense copy functions.

import { describe, it, expect } from 'vitest';
import { expenseCopies } from './expense.copies';

describe('expenseCopies', () => {
  describe('save recovery copies', () => {
    it('provides distinct network, authorization, and structure recovery instructions', () => {
      expect(expenseCopies.saveNetworkFailure()).toContain('reintentar');
      expect(expenseCopies.saveAuthorizationFailure()).toBe(
        'No pude acceder a tu planilla. Respondé *empezar* para volver a conectar tu cuenta.',
      );
      expect(expenseCopies.saveStructureFailure()).toContain('reconfigurar');
      expect(expenseCopies.saveRetryExpired()).toContain('venció');
    });

    it('formats a manual-copy fallback without claiming a successful save', () => {
      const copy = expenseCopies.saveManualCopyFallback({
        concept: 'Café',
        amount: 200,
        currency: 'EUR',
      });

      expect(copy).toContain('Café');
      expect(copy).toContain('200 EUR');
      expect(copy).not.toContain('Gasto guardado');
    });
  });

  describe('expenseSavedConfirmation', () => {
    it('includes expense details and the confirmed sheet and row', () => {
      expect(
        expenseCopies.expenseSavedConfirmation({
          concept: 'Taxi to the airport',
          amount: 500,
          currency: 'ARS',
          sheetName: 'Gastos',
          rowIndex: 47,
        }),
      ).toBe(
        "✅ *Gasto guardado*\n• Concepto: Taxi to the airport\n• Monto: 500 ARS\n• Ubicación: Guardado en 'Gastos', fila 47",
      );
    });

    it('names the confirmed sheet without a malformed row when the row is unavailable', () => {
      const copy = expenseCopies.expenseSavedConfirmation({
        concept: 'Lunch',
        amount: 12,
        currency: 'EUR',
        sheetName: 'Expenses',
      });

      expect(copy).toContain("Guardado en 'Expenses'");
      expect(copy).not.toContain('fila');
    });
  });

  it('uses the E1-US-08 orientation copy for ambiguous review replies', () => {
    expect(expenseCopies.ambiguousResponse()).toBe(
      '¿Confirmamos el registro tal como está, lo corregimos o lo cancelamos?',
    );
  });

  describe('pending expense queue copies', () => {
    it('returns the queue-full instruction in Spanish', () => {
      const copy = expenseCopies.expenseQueueFull();

      expect(copy).toBe(
        'Ya tenés 3 gastos en curso. Confirmá o cancelá el actual antes de agregar otro.',
      );
      expect(copy).not.toContain('You already have');
    });

    it('uses singular and plural grammar in pending-count notices', () => {
      expect(expenseCopies.expenseQueueNotice(1)).toBe(
        'Tenés 1 gasto pendiente. Vamos con el siguiente:',
      );
      expect(expenseCopies.expenseQueueNotice(2)).toBe(
        'Tenés 2 gastos pendientes. Vamos con el siguiente:',
      );
    });

    it('returns the exact queue-aware review reminder in Spanish', () => {
      const copy = expenseCopies.expenseQueueNonFinancialReminder(1);

      expect(copy).toBe(
        'Todavía tenés un gasto pendiente de confirmación y 1 más en la cola. ¿Querés confirmar, corregir o cancelar el actual?',
      );
      expect(copy).not.toContain('Shall we');
    });

    it('returns expiration and closing messages in Spanish', () => {
      expect(expenseCopies.expenseQueueExpirationAdvance()).toBe(
        'El registro anterior venció sin confirmación y fue cancelado. Vamos con el siguiente gasto pendiente:',
      );
      expect(expenseCopies.expenseQueueClosingSummary(1)).toBe(
        '¡Listo! Registré 1 gasto. Ya no tenés gastos pendientes.',
      );
      expect(expenseCopies.expenseQueueClosingSummary(3)).toBe(
        '¡Listo! Registré 3 gastos. Ya no tenés gastos pendientes.',
      );
    });
  });

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

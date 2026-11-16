import { describe, expect, it } from 'vitest';
import { expenseCopies, expenseGuidanceBlocks, recoveryGuidance } from './expense.copies';

describe('expense recovery composition', () => {
  it('keeps the warning, retry command and exit in separate paragraphs', () => {
    expect(expenseCopies.saveNetworkFailure()).toBe(
      'No pude confirmar el guardado por un problema de conexión.\n\nVerificá tu planilla antes de registrar el gasto nuevamente.\n\nRespondé *reintentar* dentro de los próximos 10 minutos.\n\nEscribí cancelar si quieres salir.',
    );
  });

  it('preserves correction examples and adds exactly one exit during recovery', () => {
    expect(recoveryGuidance(expenseGuidanceBlocks.correction(), 'cancellable')).toBe(
      '¿Qué querés corregir?\n\nEscribí la corrección en lenguaje natural.\n\nPor ejemplo:\n• "no, fueron 15"\n• "ponlo en transporte"\n• "es comida, subcategoría restaurante"\n• "la subcategoría es supermercado"\n• "lo pagué con Visa" o "sin medio de pago"\n• "fue ayer"\n• "no, fueron 15 y es transporte" (varios campos en un solo mensaje).\n\nEscribí cancelar si quieres salir.',
    );
  });

  it('uses explicit exit ownership rather than cancellation words in prose', () => {
    expect(
      recoveryGuidance(
        { explanation: 'Antes cancelamos el registro anterior.', action: 'Indicá el monto.' },
        'cancellable',
      ),
    ).toBe(
      'Antes cancelamos el registro anterior.\n\nIndicá el monto.\n\nEscribí cancelar si quieres salir.',
    );
    expect(
      recoveryGuidance(
        { action: '1. Escribí cancelar.\n2. Escribí empezar.', exit: '' },
        'cancellable',
      ),
    ).toBe('1. Escribí cancelar.\n2. Escribí empezar.');
  });

  it.each(['idle', 'unknown'] as const)('omits even a copy-owned exit in %s context', (context) => {
    expect(recoveryGuidance(expenseGuidanceBlocks.clarificationAmount(), context)).toBe(
      '¿Cuánto gastaste?',
    );
    expect(expenseCopies.fallbackError(context)).toBe(
      'Parece que algo falló.\n\nRevisá el último mensaje del chat.',
    );
  });

  it('overrides all supplied actions and exits when the financial result is unresolved', () => {
    const expected =
      'Esa operación sigue pendiente de resolución. No puedo iniciar otra hasta que el equipo de soporte la revise.\n\nContactá al administrador de Gastto.';
    expect(recoveryGuidance(expenseGuidanceBlocks.retryChoice(), 'financially-blocked')).toBe(
      expected,
    );
    expect(
      recoveryGuidance({ action: 'Reintentá o cancelá.', exit: 'Salir.' }, 'financially-blocked'),
    ).toBe(expected);
  });

  it('separates the review reminder from the pending queue context', () => {
    expect(expenseCopies.reviewTimeoutWarning(2)).toBe(
      '(También tenés 2 gastos esperando en la cola.)\n\n¿Confirmamos el registro? Respondé *sí* o *corregir*.\n\nEscribí cancelar si quieres salir.',
    );
  });

  it('preserves decimal amounts, currency and concept in the manual fallback', () => {
    expect(
      expenseCopies.saveManualCopyFallback({ concept: 'Café', amount: 12.75, currency: 'EUR' }),
    ).toBe(
      'No pude confirmar que el gasto se haya guardado.\n\nCopiá estos datos manualmente en tu planilla:\n• Concepto: Café\n• Monto: 12.75 EUR',
    );
  });
});

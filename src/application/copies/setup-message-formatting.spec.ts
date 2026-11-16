import { describe, expect, it } from 'vitest';
import { onboardingCopies } from './onboarding.copies';
import { settingsCopies } from './settings.copies';
import { accessCopies } from './access.copies';
import { paymentSetupCopies } from './payment-setup.copies';

describe('setup message formatting', () => {
  it('preserves settings numbering and separates the requested action and exit', () => {
    expect(settingsCopies.menu()).toBe(
      'Configuración de planilla:\n1. Ver estado\n2. Volver a autorizar Google\n3. Cambiar planilla\n4. Cambiar hoja\n5. Categorías y subcategorías\n6. Medios de pago\n7. Cambiar email de Google\n\nEscribí el número de una opción.\n\nEscribí cancelar si quieres salir.',
    );
  });

  it('keeps column choices separate from correction instructions', () => {
    expect(
      onboardingCopies.invalidColumnPrompt('Z', [
        { index: 0, columnHeader: 'Fecha' },
        { index: 1, columnHeader: 'Monto' },
      ]),
    ).toBe(
      'No encontré la columna *Z* en tu planilla.\n\nLas columnas disponibles son:\nA - Fecha\nB - Monto\n\nEscribí la letra, número o nombre correcto.\n\nEscribí cancelar si quieres salir.',
    );
  });

  it('preserves nested categories and places cancellation after the whole hierarchy', () => {
    expect(
      onboardingCopies.hierarchyUpdateGuidance({
        categories: [{ name: 'Comida', subcategories: ['Café'] }],
        orphanSubcategories: [],
      }),
    ).toBe(
      'No entendí el cambio.\n\nIndicá siempre la categoría padre de una subcategoría. Por ejemplo: "agregar Peajes a Transporte".\n\nJerarquía actual:\n• Comida\n  ◦ Café\n\nEscribí cancelar si quieres salir.',
    );
  });

  it('separates payment choices and the unmapped-column warning', () => {
    expect(paymentSetupCopies.onboardingReview(['Efectivo', 'Tarjeta'], false)).toBe(
      'Revisá los medios de pago:\n• Efectivo\n• Tarjeta\n\nSin columna mapeada: se guardarán solo en Gastto.\n\nOpciones:\n• Escribí confirmar para activar toda la configuración.\n• agregar Nombre\n• renombrar Nombre a Otro\n• quitar Nombre\n\nEscribí cancelar si quieres salir.',
    );
  });

  it('lists payment editing examples and preserves the empty-catalog confirmation', () => {
    expect(settingsCopies.paymentDraft([], true)).toBe(
      'Borrador de medios de pago:\n(sin medios de pago)\n\nEjemplos:\n• detectar\n• agregar Efectivo\n• renombrar Efectivo a Dinero\n• quitar Dinero\n\nEscribí confirmar para guardar este catálogo, incluso si está vacío.\n\nLos cambios sin confirmar se descartarán al salir.\n\nEscribí cancelar si quieres salir.',
    );
  });

  it('offers cancellation for replacement emails but not initial admission', () => {
    expect(accessCopies.invalidEmail()).toBe(
      'El email que ingresaste no tiene un formato válido.\n\nRevisalo y volvé a escribirlo.',
    );
    expect(accessCopies.invalidReplacementEmail()).toBe(
      'El email que ingresaste no tiene un formato válido.\n\nRevisalo y volvé a escribirlo.\n\nEscribí cancelar si quieres salir.',
    );
    expect(accessCopies.requestSaveFailed()).not.toContain('cancelar');
    expect(accessCopies.replacementSaveFailed()).toBe(
      'No pudimos guardar el cambio de email.\n\nVolvé a enviarlo para intentarlo de nuevo.\n\nEscribí cancelar si quieres salir.',
    );
  });

  it('preserves OAuth URLs without adding markup to the chat message', () => {
    expect(settingsCopies.authLink('https://example.com/auth?state=abc&scope=drive')).toBe(
      'Tu planilla actual sigue activa hasta confirmar el acceso.\n\nPara volver a autorizar Google, abrí este enlace: https://example.com/auth?state=abc&scope=drive\n\nEscribí cancelar si quieres salir.',
    );
  });

  it('does not duplicate optional cancellation in a required restart sequence', () => {
    expect(settingsCopies.configurationChanged()).toBe(
      'La configuración cambió.\n\n1. Escribí cancelar para salir.\n2. Escribí configuración para abrirla de nuevo.',
    );
  });
});

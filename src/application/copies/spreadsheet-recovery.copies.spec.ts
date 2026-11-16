import { describe, expect, it } from 'vitest';
import { SpreadsheetError } from '../../domain/errors/SpreadsheetError';
import { SheetInfo } from '../../domain/entities/SheetInfo';
import { spreadsheetRecoveryCopies } from './spreadsheet-recovery.copies';
import { onboardingCopies } from './onboarding.copies';
import { settingsCopies } from './settings.copies';

describe('readable spreadsheet recovery', () => {
  it('separates conversion steps from the optional exit', () => {
    expect(spreadsheetRecoveryCopies.unsupportedFormat()).toBe(
      'Ese archivo no es una planilla nativa de Google.\n\n1. Abrilo en Google Sheets y guardalo como una planilla de Google.\n2. Pegá el enlace del archivo convertido o elegí otra planilla compatible.\n\nEscribí cancelar si quieres salir.',
    );
  });

  it.each(['reintentar', 'otra hoja', 'no sé', 'la misma selección'])(
    'preserves the valid retry command: %s',
    (command) => {
      expect(
        spreadsheetRecoveryCopies.readFailure(
          new SpreadsheetError('private provider error', { retryable: true }),
          'onboarding',
          command,
        ),
      ).toBe(
        `No pude consultar la planilla por un problema temporal.\n\nEn unos segundos, enviá ${command} para volver a intentar.\n\nEscribí cancelar si quieres salir.`,
      );
    },
  );

  it.each([
    ['onboarding', '2. Escribí empezar.'],
    ['settings', '2. Escribí configuración.\n3. Elegí la opción 3.'],
  ] as const)(
    'shows required restart steps without an optional footer for %s',
    (flow, finalSteps) => {
      expect(spreadsheetRecoveryCopies.readFailure(new Error('private provider error'), flow)).toBe(
        `No pude leer las hojas o su estructura.\n\nRevisá el archivo en Google Sheets. Para elegir otro archivo:\n1. Escribí cancelar para salir de la configuración actual.\n${finalSteps}`,
      );
      expect(spreadsheetRecoveryCopies.emptySheets(flow)).toBe(
        `El archivo no tiene hojas disponibles.\n\nPara elegir otro archivo:\n1. Escribí cancelar para salir de la configuración actual.\n${finalSteps}`,
      );
    },
  );

  it('keeps the optional exit off the last sheet item', () => {
    expect(
      onboardingCopies.sheetNotFoundRePrompt([
        new SheetInfo({ name: 'Gastos', index: 0 }),
        new SheetInfo({ name: 'Resumen', index: 1 }),
      ]),
    ).toBe(
      'No encontré esa hoja.\n\nElegí una de estas:\n1. Gastos\n2. Resumen\n\nEscribí cancelar si quieres salir.',
    );
  });

  it('separates settings file choices, supported inputs and optional exit', () => {
    expect(settingsCopies.filePrompt([{ name: 'Gastos' }, { name: 'Viajes' }])).toBe(
      'Elegí una planilla:\n1. Gastos\n2. Viajes\n\nEscribí el número, buscar, buscar seguido del nombre o un enlace de Google Sheets.\n\nEscribí cancelar si quieres salir.',
    );
    expect(settingsCopies.sheetPrompt([{ name: 'Resumen' }])).toBe(
      'Elegí una hoja:\n1. Resumen\n\nEscribí el número.\n\nEscribí cancelar si quieres salir.',
    );
  });
});

// LAYER: Application / Tests
// Unit tests for onboarding copy functions.
// All copy functions are pure (no side effects) and accept only serializable arguments.

import { describe, it, expect } from 'vitest';
import { onboardingCopies } from './onboarding.copies';
import { CloudFile } from '../../domain/entities/CloudFile';
import { SheetInfo } from '../../domain/entities/SheetInfo';

describe('onboardingCopies', () => {
  describe('welcomePrompt', () => {
    it('returns a welcome message with provider options', () => {
      const result = onboardingCopies.welcomePrompt();

      expect(result).toContain('Bienvenido a Gastto');
      expect(result).toContain('1. Google Drive');
      expect(result).toContain('2. OneDrive');
    });
  });

  describe('fileListPrompt', () => {
    it('returns a numbered list with file names and a "None of these" option', () => {
      const files = [
        new CloudFile({
          id: 'f1',
          name: 'Gastos 2026',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          modifiedAt: new Date('2026-01-15T10:00:00Z'),
        }),
        new CloudFile({
          id: 'f2',
          name: 'Presupuesto',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          modifiedAt: new Date('2026-01-14T10:00:00Z'),
        }),
      ];

      const result = onboardingCopies.fileListPrompt(files);

      expect(result).toContain('Encontré estos archivos recientes:');
      expect(result).toContain('1. Gastos 2026');
      expect(result).toContain('2. Presupuesto');
      expect(result).toContain('3. Ninguno de estos / buscar por nombre');
    });

    it('handles an empty file list', () => {
      const result = onboardingCopies.fileListPrompt([]);

      expect(result).toContain('Encontré estos archivos recientes:');
      expect(result).toContain('1. Ninguno de estos / buscar por nombre');
    });
  });

  describe('noFilesFoundPrompt', () => {
    it('returns guidance text suggesting verification and manual name entry', () => {
      const result = onboardingCopies.noFilesFoundPrompt();

      expect(result).toContain('No encontré archivos de planilla');
      expect(result).toContain('Verificá que tengas archivos en Google Drive');
      expect(result).toContain('escribí parte del nombre para buscar');
    });
  });

  describe('fileSelectedConfirmation', () => {
    it('returns a confirmation with the file name in bold Markdown', () => {
      const result = onboardingCopies.fileSelectedConfirmation('Gastos 2026');

      expect(result).toContain('*Gastos 2026*');
      expect(result).toContain('Elegiste');
      expect(result).toContain('Ahora vamos a seleccionar la hoja');
    });
  });

  describe('invalidSelectionRePrompt', () => {
    it('returns a re-prompt with the correct range and search option', () => {
      const result = onboardingCopies.invalidSelectionRePrompt(3);

      expect(result).toContain('No entendí');
      expect(result).toContain('*1* al *3*');
      expect(result).toContain('*4* para buscar por nombre');
    });

    it('adjusts the range and search option for different file counts', () => {
      const result = onboardingCopies.invalidSelectionRePrompt(5);

      expect(result).toContain('*1* al *5*');
      expect(result).toContain('*6* para buscar por nombre');
    });
  });

  describe('searchByNamePrompt', () => {
    it('returns a prompt asking the user to type part of the file name', () => {
      const result = onboardingCopies.searchByNamePrompt();

      expect(result).toContain('Escribí parte del nombre del archivo');
    });
  });

  describe('urlValidationFailed', () => {
    it('returns a permission and link validation error message', () => {
      const result = onboardingCopies.urlValidationFailed();

      expect(result).toContain('No pude acceder a ese archivo');
      expect(result).toContain('Verificá que el enlace sea correcto');
      expect(result).toContain('que tengas permisos');
    });
  });

  describe('urlValidationSuccess', () => {
    it('returns a confirmation with the file name in bold Markdown', () => {
      const result = onboardingCopies.urlValidationSuccess('Mi Planilla.xlsx');

      expect(result).toContain('*Mi Planilla.xlsx*');
      expect(result).toContain('Elegiste');
      expect(result).toContain('Ahora vamos a seleccionar la hoja');
    });
  });

  describe('singleSheetConfirmation', () => {
    it('returns an auto-confirmation message with the sheet name in bold Markdown', () => {
      const result = onboardingCopies.singleSheetConfirmation('Gastos');

      expect(result).toContain('Solo encontré una hoja:');
      expect(result).toContain('*Gastos*');
      expect(result).toContain('registrar tus gastos');
    });
  });

  describe('sheetListPrompt', () => {
    it('returns a numbered list of sheet names with an "I don\'t know" option as the last item', () => {
      const sheets = [
        new SheetInfo({ name: 'Gastos', index: 0 }),
        new SheetInfo({ name: 'Resumen', index: 1 }),
      ];

      const result = onboardingCopies.sheetListPrompt(sheets);

      expect(result).toContain('1. Gastos');
      expect(result).toContain('2. Resumen');
      expect(result).toContain('3. No sé / ninguna de estas');
      expect(result).toContain('El archivo tiene 2 hojas');
    });

    it('handles a single sheet', () => {
      const sheets = [new SheetInfo({ name: 'Gastos', index: 0 })];
      const result = onboardingCopies.sheetListPrompt(sheets);

      expect(result).toContain('1. Gastos');
      expect(result).toContain('2. No sé / ninguna de estas');
    });

    it('handles an empty sheet list', () => {
      const sheets: SheetInfo[] = [];
      const result = onboardingCopies.sheetListPrompt(sheets);

      expect(result).toContain('1. No sé / ninguna de estas');
    });
  });

  describe('sheetSelectedConfirmation', () => {
    it('returns a confirmation with the sheet name and transition hint', () => {
      const result = onboardingCopies.sheetSelectedConfirmation('Gastos');

      expect(result).toContain('*Gastos*');
      expect(result).toContain('Elegiste la hoja');
      expect(result).toContain('analizar la estructura');
    });
  });

  describe('sheetNotFoundRePrompt', () => {
    it('returns a "not found" message with the sheet list', () => {
      const sheets = [
        new SheetInfo({ name: 'Gastos', index: 0 }),
        new SheetInfo({ name: 'Resumen', index: 1 }),
      ];

      const result = onboardingCopies.sheetNotFoundRePrompt(sheets);

      expect(result).toContain('No encontré esa hoja');
      expect(result).toContain('1. Gastos');
      expect(result).toContain('2. Resumen');
    });

    it('handles a single sheet in the list', () => {
      const sheets = [new SheetInfo({ name: 'Gastos', index: 0 })];
      const result = onboardingCopies.sheetNotFoundRePrompt(sheets);

      expect(result).toContain('1. Gastos');
    });

    it('handles empty sheet list', () => {
      const result = onboardingCopies.sheetNotFoundRePrompt([]);

      expect(result).toContain('No encontré esa hoja');
    });
  });

  describe('sheetHeadersDescription', () => {
    it('returns a description of the sheet columns', () => {
      const result = onboardingCopies.sheetHeadersDescription('Gastos', [
        'Fecha',
        'Concepto',
        'Monto',
      ]);

      expect(result).toContain('*Gastos*');
      expect(result).toContain('Fecha');
      expect(result).toContain('Concepto');
      expect(result).toContain('Monto');
    });
  });

  describe('sheetHeaderDescription', () => {
    it('returns combined descriptions for multiple sheets', () => {
      const descriptions = [
        { sheetName: 'Gastos', headers: ['Fecha', 'Concepto', 'Monto'] },
        { sheetName: 'Resumen', headers: ['Categoría', 'Total'] },
      ];

      const result = onboardingCopies.sheetHeaderDescription(descriptions);

      expect(result).toContain('*Gastos*');
      expect(result).toContain('Fecha, Concepto, Monto');
      expect(result).toContain('*Resumen*');
      expect(result).toContain('Categoría, Total');
    });

    it('handles a single sheet description', () => {
      const descriptions = [{ sheetName: 'Gastos', headers: ['Fecha', 'Monto'] }];

      const result = onboardingCopies.sheetHeaderDescription(descriptions);

      expect(result).toContain('*Gastos*');
      expect(result).toContain('Fecha, Monto');
    });

    it('handles empty descriptions array', () => {
      const result = onboardingCopies.sheetHeaderDescription([]);

      expect(result).toBe('');
    });
  });

  describe('sheetMappingTransition', () => {
    it('returns the transition message to structure analysis', () => {
      const result = onboardingCopies.sheetMappingTransition();

      expect(result).toContain('analizar la estructura');
    });
  });

  describe('invalidDataStartRowPrompt', () => {
    it('returns a re-prompt asking for a valid data-start row greater than 1', () => {
      const result = onboardingCopies.invalidDataStartRowPrompt();

      expect(result).toContain('No entendí la fila');
      expect(result).toContain('número de fila');
      expect(result).toContain('mayor a 1');
    });
  });

  describe('mappingRejectionPrompt', () => {
    it('lists available columns and invites manual correction with an example', () => {
      const columns = [
        { index: 0, columnHeader: 'Fecha' },
        { index: 1, columnHeader: 'Monto' },
        { index: 2, columnHeader: 'Categoría' },
      ];

      const result = onboardingCopies.mappingRejectionPrompt(columns);

      expect(result).toContain('Entendido');
      expect(result).toContain('A - Fecha');
      expect(result).toContain('B - Monto');
      expect(result).toContain('C - Categoría');
      expect(result).toContain('Los campos que podés indicar son');
      expect(result).toContain('Fecha');
      expect(result).toContain('Monto');
      expect(result).toContain('Categoría');
      expect(result).toContain('Indicame dónde está cada campo');
      expect(result).toContain('la categoría está en la columna E');
    });

    it('marks empty headers as (vacía) and truncates very long headers', () => {
      const columns = [
        { index: 0, columnHeader: '' },
        {
          index: 1,
          columnHeader: 'Para añadir o cambiar categorías, modifica las tablas de la hoja Resumen',
        },
      ];

      const result = onboardingCopies.mappingRejectionPrompt(columns);

      expect(result).toContain('A - (vacía)');
      expect(result).toContain('B - Para añadir o cambiar categorías, modifi…');
      expect(result).not.toContain('tablas de la hoja Resumen');
    });
  });
});

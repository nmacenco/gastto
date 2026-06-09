// LAYER: Application / Tests
// Unit tests for onboarding copy functions.
// All copy functions are pure (no side effects) and accept only serializable arguments.

import { describe, it, expect } from 'vitest';
import { onboardingCopies } from './onboarding.copies';
import { CloudFile } from '../../domain/entities/CloudFile';

describe('onboardingCopies', () => {
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
});

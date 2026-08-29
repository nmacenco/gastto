// LAYER: Infrastructure / Tests
// Unit tests for RuleBasedColumnInferenceAdapter.
// Covers all 5 Gherkin scenarios from HU-4.05.

import { describe, it, expect } from 'vitest';
import { RuleBasedColumnInferenceAdapter } from './RuleBasedColumnInferenceAdapter';

describe('RuleBasedColumnInferenceAdapter', () => {
  const adapter = new RuleBasedColumnInferenceAdapter();

  describe('Scenario 1: Clear headers — high-confidence mapping', () => {
    it('maps recognizable headers with alta confidence', async () => {
      const headers = ['Fecha', 'Monto', 'Categoria', 'Concepto', 'Medio de pago'];
      const sampleRows: string[][] = [];

      const result = await adapter.infer(headers, sampleRows);

      expect(result.noHeaderFound).toBe(false);
      expect(result.mappings).toHaveLength(5);
      expect(result.mappings.every((m) => m.confidence === 'alta')).toBe(true);

      const fechaMapping = result.mappings.find((m) => m.gasttoField === 'fecha');
      expect(fechaMapping).toBeDefined();
      expect(fechaMapping?.columnIndex).toBe(0);
      expect(fechaMapping?.columnHeader).toBe('Fecha');

      const montoMapping = result.mappings.find((m) => m.gasttoField === 'monto');
      expect(montoMapping).toBeDefined();
      expect(montoMapping?.columnIndex).toBe(1);
    });

    it('maps all 6 GasttoField values with exact match', async () => {
      const headers = ['fecha', 'monto', 'moneda', 'categoria', 'concepto', 'medio_pago'];
      const result = await adapter.infer(headers, []);

      expect(result.mappings).toHaveLength(6);
      expect(result.mappings.every((m) => m.confidence === 'alta')).toBe(true);
      expect(result.unmappedFields).toHaveLength(0);
    });
  });

  describe('Scenario 2: Ambiguous headers — low-confidence mapping', () => {
    it('maps fuzzy matches with baja confidence', async () => {
      const headers = ['Fcha', 'Mnto', 'Ctegoria'];
      const result = await adapter.infer(headers, []);

      expect(result.mappings.length).toBeGreaterThan(0);
      expect(result.mappings.some((m) => m.confidence === 'baja')).toBe(true);
    });

    it('boosts confidence to alta when content-type validation passes', async () => {
      const headers = ['Fcha', 'Mnto'];
      const sampleRows = [
        ['01/01/2026', '100.50'],
        ['02/01/2026', '200.75'],
      ];

      const result = await adapter.infer(headers, sampleRows);

      const fechaMapping = result.mappings.find((m) => m.gasttoField === 'fecha');
      expect(fechaMapping?.confidence).toBe('alta');

      const montoMapping = result.mappings.find((m) => m.gasttoField === 'monto');
      expect(montoMapping?.confidence).toBe('alta');
    });
  });

  describe('Scenario 3: No headers — row 1 contains data', () => {
    it('detects no-header condition when all values are numeric/date', async () => {
      const headers = ['01/01/2026', '100.50', 'USD', 'ARS'];
      const result = await adapter.infer(headers, []);

      expect(result.noHeaderFound).toBe(true);
      expect(result.mappings).toHaveLength(0);
      expect(result.unmappedFields).toHaveLength(6);
    });

    it('does not detect no-header when at least one header is a string label', async () => {
      const headers = ['Fecha', '100.50', 'USD'];
      const result = await adapter.infer(headers, []);

      expect(result.noHeaderFound).toBe(false);
      expect(result.mappings.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario 4: FinFlow field with no equivalent column', () => {
    it('reports unmapped fields when no column matches', async () => {
      const headers = ['Fecha', 'Monto'];
      const result = await adapter.infer(headers, []);

      expect(result.mappings).toHaveLength(2);
      expect(result.unmappedFields).toContain('categoria');
      expect(result.unmappedFields).toContain('concepto');
      expect(result.unmappedFields).toContain('medio_pago');
      expect(result.unmappedFields).toContain('moneda');
    });

    it('returns all fields as unmapped when no headers match', async () => {
      const headers = ['Col1', 'Col2', 'Col3'];
      const result = await adapter.infer(headers, []);

      expect(result.mappings).toHaveLength(0);
      expect(result.unmappedFields).toHaveLength(6);
    });
  });

  describe('Scenario 5: Spreadsheet with columns in a language other than Spanish', () => {
    it('recognizes English headers correctly', async () => {
      const headers = ['Date', 'Amount', 'Category', 'Description', 'Payment method'];
      const result = await adapter.infer(headers, []);

      expect(result.mappings).toHaveLength(5);
      expect(result.mappings.every((m) => m.confidence === 'alta')).toBe(true);

      const dateMapping = result.mappings.find((m) => m.gasttoField === 'fecha');
      expect(dateMapping?.columnHeader).toBe('Date');

      const amountMapping = result.mappings.find((m) => m.gasttoField === 'monto');
      expect(amountMapping?.columnHeader).toBe('Amount');
    });

    it('recognizes Portuguese headers correctly', async () => {
      const headers = ['Data', 'Valor', 'Categoria', 'Descricao', 'Meio de pagamento'];
      const result = await adapter.infer(headers, []);

      expect(result.mappings).toHaveLength(5);
      expect(result.mappings.every((m) => m.confidence === 'alta')).toBe(true);

      const dataMapping = result.mappings.find((m) => m.gasttoField === 'fecha');
      expect(dataMapping?.columnHeader).toBe('Data');

      const valorMapping = result.mappings.find((m) => m.gasttoField === 'monto');
      expect(valorMapping?.columnHeader).toBe('Valor');
    });
  });

  describe('Header normalization', () => {
    it('normalizes headers with accents and whitespace', async () => {
      const headers = ['  Fecha  ', 'Mónto', 'Categoría'];
      const result = await adapter.infer(headers, []);

      expect(result.mappings).toHaveLength(3);
      expect(result.mappings.every((m) => m.confidence === 'alta')).toBe(true);
    });

    it('handles case-insensitive matching', async () => {
      const headers = ['FECHA', 'MONTO', 'CATEGORIA'];
      const result = await adapter.infer(headers, []);

      expect(result.mappings).toHaveLength(3);
      expect(result.mappings.every((m) => m.confidence === 'alta')).toBe(true);
    });
  });

  describe('Content-type validation', () => {
    it('accepts signed localized currency amounts', async () => {
      const result = await adapter.infer(['Importe'], [['-$2.787,56']]);

      expect(result.mappings).toEqual([
        {
          gasttoField: 'monto',
          columnIndex: 0,
          columnHeader: 'Importe',
          confidence: 'alta',
        },
      ]);
    });

    it('reduces confidence to baja when content-type does not match', async () => {
      const headers = ['Fecha', 'Monto'];
      const sampleRows = [
        ['not-a-date', 'not-a-number'],
        ['also-not', 'still-not'],
      ];

      const result = await adapter.infer(headers, sampleRows);

      const fechaMapping = result.mappings.find((m) => m.gasttoField === 'fecha');
      expect(fechaMapping?.confidence).toBe('baja');

      const montoMapping = result.mappings.find((m) => m.gasttoField === 'monto');
      expect(montoMapping?.confidence).toBe('baja');
    });
  });

  describe('Edge cases', () => {
    it('returns empty mappings when headers array is empty', async () => {
      const result = await adapter.infer([], []);

      expect(result.mappings).toHaveLength(0);
      expect(result.noHeaderFound).toBe(false);
      expect(result.unmappedFields).toHaveLength(6);
    });

    it('does not map the same field twice', async () => {
      const headers = ['Fecha', 'Date', 'Dia'];
      const result = await adapter.infer(headers, []);

      const fechaMappings = result.mappings.filter((m) => m.gasttoField === 'fecha');
      expect(fechaMappings).toHaveLength(1);
    });
  });
});

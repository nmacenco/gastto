// LAYER: Application / Tests
// Unit tests for RuleBasedColumnMappingCorrectionParser.
// No mocks required: the parser is deterministic and has no external dependencies.

import { describe, it, expect } from 'vitest';
import {
  RuleBasedColumnMappingCorrectionParser,
  type CorrectionParseResult,
} from './ColumnMappingCorrectionParser';
import type { GasttoField } from '../../domain/entities/SpreadsheetConfig';

function assertSuccess(
  result: CorrectionParseResult,
): asserts result is { kind: 'success'; field: GasttoField; columnRef: string } {
  expect(result.kind).toBe('success');
}

describe('RuleBasedColumnMappingCorrectionParser', () => {
  const parser = new RuleBasedColumnMappingCorrectionParser();

  describe('successful Spanish corrections', () => {
    it('parses "la categoría está en la columna E"', () => {
      const result = parser.parse('la categoría está en la columna E');
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>('categoria');
      expect(result.columnRef).toBe('E');
    });

    it('parses "el monto va en B"', () => {
      const result = parser.parse('el monto va en B');
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>('monto');
      expect(result.columnRef).toBe('B');
    });

    it('parses "la fecha es la columna A"', () => {
      const result = parser.parse('la fecha es la columna A');
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>('fecha');
      expect(result.columnRef).toBe('A');
    });

    it('parses "cambia el concepto a la columna 5"', () => {
      const result = parser.parse('cambia el concepto a la columna 5');
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>('concepto');
      expect(result.columnRef).toBe('5');
    });

    it('parses abbreviated "col F"', () => {
      const result = parser.parse('la moneda está en col F');
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>('moneda');
      expect(result.columnRef).toBe('F');
    });
  });

  describe('successful English corrections', () => {
    it('parses "no, the category is in column E"', () => {
      const result = parser.parse('no, the category is in column E');
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>('categoria');
      expect(result.columnRef).toBe('E');
    });

    it('parses "the amount goes in column 3"', () => {
      const result = parser.parse('the amount goes in column 3');
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>('monto');
      expect(result.columnRef).toBe('3');
    });

    it('parses "date is A"', () => {
      const result = parser.parse('date is A');
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>('fecha');
      expect(result.columnRef).toBe('A');
    });
  });

  describe('payment method field', () => {
    it('recognizes "medio de pago"', () => {
      const result = parser.parse('el medio de pago está en D');
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>('medio_pago');
      expect(result.columnRef).toBe('D');
    });

    it('recognizes "payment method"', () => {
      const result = parser.parse('payment method is column G');
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>('medio_pago');
      expect(result.columnRef).toBe('G');
    });
  });

  describe('quoted header names', () => {
    it('parses "el concepto es \"Descripción\""', () => {
      const result = parser.parse('el concepto es "Descripción"');
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>('concepto');
      // Parser normalizes accented characters and lowercases input.
      expect(result.columnRef).toBe('DESCRIPCION');
    });
  });

  describe('parse failures', () => {
    it('fails on plain confirmation "sí"', () => {
      const result = parser.parse('sí');
      expect(result.kind).toBe('failure');
    });

    it('fails on plain "no"', () => {
      const result = parser.parse('no');
      expect(result.kind).toBe('failure');
    });

    it('fails when a field is mentioned without a column reference', () => {
      const result = parser.parse('la categoría es baja');
      expect(result.kind).toBe('failure');
    });

    it('fails on unrelated text', () => {
      const result = parser.parse('hola, ¿cómo estás?');
      expect(result.kind).toBe('failure');
    });
  });

  describe('field synonym coverage', () => {
    const cases: { message: string; expectedField: GasttoField }[] = [
      { message: 'monto en A', expectedField: 'monto' },
      { message: 'amount en A', expectedField: 'monto' },
      { message: 'moneda en A', expectedField: 'moneda' },
      { message: 'currency en A', expectedField: 'moneda' },
      { message: 'categoria en A', expectedField: 'categoria' },
      { message: 'category en A', expectedField: 'categoria' },
      { message: 'fecha en A', expectedField: 'fecha' },
      { message: 'date en A', expectedField: 'fecha' },
      { message: 'concepto en A', expectedField: 'concepto' },
      { message: 'description en A', expectedField: 'concepto' },
      { message: 'medio de pago en A', expectedField: 'medio_pago' },
      { message: 'payment method en A', expectedField: 'medio_pago' },
    ];

    it.each(cases)('recognizes "$message" as $expectedField', ({ message, expectedField }) => {
      const result = parser.parse(message);
      assertSuccess(result);
      expect(result.field).toBe<GasttoField>(expectedField);
    });
  });
});

// LAYER: Domain tests
// Pure domain tests for ColumnMappingCorrectionState.

import { describe, it, expect } from 'vitest';
import { ColumnMappingCorrectionState } from './ColumnMappingCorrectionState';
import type { MappingCorrectionStatus } from './ColumnMappingCorrectionState';
import type { ColumnMapping } from '../entities/SpreadsheetConfig';

function buildMapping(overrides: Partial<ColumnMapping> = {}): ColumnMapping {
  return {
    id: 'mapping-1',
    spreadsheetId: 'sheet-1',
    GasttoField: 'fecha',
    columnIndex: 0,
    columnHeader: 'Fecha',
    inferred: true,
    confirmedAt: null,
    ...overrides,
  };
}

describe('ColumnMappingCorrectionState', () => {
  it('creates a proposed state from the original mapping', () => {
    const original = [buildMapping()];
    const state = ColumnMappingCorrectionState.create(original);

    expect(state.status).toBe<MappingCorrectionStatus>('proposed');
    expect(state.originalMapping).toHaveLength(1);
    expect(state.corrections).toHaveLength(0);
    expect(state.getCurrentMapping()).toEqual(original);
  });

  it('applies a correction and switches to correcting status', () => {
    const original = [
      buildMapping({ GasttoField: 'categoria', columnIndex: 2, columnHeader: 'Cat' }),
    ];
    const state = ColumnMappingCorrectionState.create(original);

    const corrected = state.applyCorrection({
      field: 'categoria',
      columnIndex: 4,
      columnHeader: 'Categoría',
    });

    expect(corrected.status).toBe<MappingCorrectionStatus>('correcting');
    expect(corrected.corrections).toHaveLength(1);
    expect(corrected.getCurrentMapping()[0]!.columnIndex).toBe(4);
    expect(corrected.getCurrentMapping()[0]!.columnHeader).toBe('Categoría');
  });

  it('replaces a previous correction for the same field', () => {
    const original = [
      buildMapping({ GasttoField: 'monto', columnIndex: 1, columnHeader: 'Monto' }),
    ];
    const state = ColumnMappingCorrectionState.create(original)
      .applyCorrection({ field: 'monto', columnIndex: 5, columnHeader: 'Valor' })
      .applyCorrection({ field: 'monto', columnIndex: 6, columnHeader: 'Importe' });

    expect(state.corrections).toHaveLength(1);
    expect(state.getCurrentMapping()[0]!.columnIndex).toBe(6);
    expect(state.getCurrentMapping()[0]!.columnHeader).toBe('Importe');
  });

  it('keeps uncorrected fields unchanged', () => {
    const original = [
      buildMapping({ GasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha' }),
      buildMapping({ GasttoField: 'monto', columnIndex: 1, columnHeader: 'Monto' }),
    ];
    const state = ColumnMappingCorrectionState.create(original).applyCorrection({
      field: 'monto',
      columnIndex: 2,
      columnHeader: 'Importe',
    });

    expect(state.getCurrentMapping()[0]).toEqual(original[0]);
    expect(state.getCurrentMapping()[1]!.columnIndex).toBe(2);
  });

  it('adds a correction for a field missing from the original proposal', () => {
    const original = [
      buildMapping({ GasttoField: 'medio_pago', columnIndex: 0, columnHeader: '' }),
    ];
    const state = ColumnMappingCorrectionState.create(original).applyCorrection({
      field: 'categoria',
      columnIndex: 2,
      columnHeader: '',
    });

    expect(state.getCurrentMapping()).toEqual([
      original[0],
      expect.objectContaining({
        GasttoField: 'categoria',
        columnIndex: 2,
        columnHeader: '',
        inferred: false,
      }),
    ]);
  });

  it('confirms the state without losing corrections', () => {
    const original = [
      buildMapping({ GasttoField: 'concepto', columnIndex: 3, columnHeader: 'Desc' }),
    ];
    const state = ColumnMappingCorrectionState.create(original)
      .applyCorrection({ field: 'concepto', columnIndex: 4, columnHeader: 'Descripción' })
      .confirm();

    expect(state.status).toBe<MappingCorrectionStatus>('confirmed');
    expect(state.getCurrentMapping()[0]!.columnIndex).toBe(4);
  });

  it('is immutable', () => {
    const original = [buildMapping()];
    const state = ColumnMappingCorrectionState.create(original);
    const corrected = state.applyCorrection({
      field: 'fecha',
      columnIndex: 7,
      columnHeader: 'Date',
    });

    expect(state.status).toBe('proposed');
    expect(state.corrections).toHaveLength(0);
    expect(corrected.status).toBe('correcting');
  });
});

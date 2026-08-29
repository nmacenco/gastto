// LAYER: Infrastructure / Tests
// Unit tests for RuleBasedHeaderDetectionAdapter.

import { describe, it, expect } from 'vitest';
import { RuleBasedHeaderDetectionAdapter } from './RuleBasedHeaderDetectionAdapter';

describe('RuleBasedHeaderDetectionAdapter', () => {
  const adapter = new RuleBasedHeaderDetectionAdapter();

  it('detects headers in the first row when they are labels', async () => {
    const rows = [
      { index: 1, values: ['Fecha', 'Monto', 'Categoria'] },
      { index: 2, values: ['01/01/2026', '100.50', 'Comida'] },
    ];

    const result = await adapter.detectHeaderRow(rows);

    expect(result).toBe(1);
  });

  it('detects headers in a later row when earlier rows are empty', async () => {
    const rows = [
      { index: 1, values: ['', '', ''] },
      { index: 2, values: ['', '', ''] },
      { index: 3, values: ['', '', ''] },
      { index: 4, values: ['', '', ''] },
      { index: 5, values: ['Fecha', 'Monto', 'Categoria'] },
      { index: 6, values: ['01/01/2026', '100.50', 'Comida'] },
    ];

    const result = await adapter.detectHeaderRow(rows);

    expect(result).toBe(5);
  });

  it('detects headers in a later row when earlier rows contain data-like values', async () => {
    const rows = [
      { index: 1, values: ['01/01/2024', '15.50', 'USD'] },
      { index: 2, values: ['02/01/2024', '23.00', 'ARS'] },
      { index: 3, values: ['Fecha', 'Monto', 'Categoria'] },
      { index: 4, values: ['03/01/2024', '9.99', 'USD'] },
    ];

    const result = await adapter.detectHeaderRow(rows);

    expect(result).toBe(3);
  });

  it('prefers recognized headers below title and summary rows', async () => {
    const rows = [
      {
        index: 1,
        values: [
          '',
          'Para añadir o cambiar categorías, modifica las tablas Ingresos y Gastos de la hoja Resumen.',
        ],
      },
      { index: 2, values: ['', 'Gastos'] },
      { index: 3, values: ['', '', '', 'Sin Tarjeta', '$0,00'] },
      { index: 4, values: ['', '', '', 'Con tarjeta', '$0,00', '-$2.787,56'] },
      {
        index: 5,
        values: ['', 'Fecha', 'Categoría', 'Subcategoría', 'Importe', 'Descripción'],
      },
    ];

    const result = await adapter.detectHeaderRow(rows);

    expect(result).toBe(5);
  });

  it('counts distinct Gastto fields when ranking recognized candidates', async () => {
    const rows = [
      { index: 1, values: ['Total', '$0,00', 'Importe'] },
      { index: 2, values: ['Fecha', 'Monto'] },
    ];

    const result = await adapter.detectHeaderRow(rows);

    expect(result).toBe(2);
  });

  it('returns null when all rows contain only data-like values', async () => {
    const rows = [
      { index: 1, values: ['01/01/2026', '100.50', 'USD'] },
      { index: 2, values: ['02/01/2026', '-$2.787,56', 'ARS'] },
    ];

    const result = await adapter.detectHeaderRow(rows);

    expect(result).toBeNull();
  });

  it('returns null when all rows are empty', async () => {
    const rows = [
      { index: 1, values: ['', '', ''] },
      { index: 2, values: ['', '', ''] },
    ];

    const result = await adapter.detectHeaderRow(rows);

    expect(result).toBeNull();
  });

  it('skips a sheet-title row with a single value and finds headers in a later row', async () => {
    const rows = [
      { index: 1, values: ['', 'Para añadir o cambiar categorías, modifica las tablas'] },
      { index: 2, values: ['Fecha', 'Monto', 'Categoria'] },
      { index: 3, values: ['01/01/2026', '100.50', 'Comida'] },
    ];

    const result = await adapter.detectHeaderRow(rows);

    expect(result).toBe(2);
  });

  it('returns null when the only candidate row has a single non-empty value and no later headers exist', async () => {
    const rows = [
      { index: 1, values: ['', 'Para añadir o cambiar categorías, modifica las tablas'] },
      { index: 2, values: ['01/01/2026', '100.50', 'USD'] },
    ];

    const result = await adapter.detectHeaderRow(rows);

    expect(result).toBeNull();
  });

  it('returns null for an empty row list', async () => {
    const result = await adapter.detectHeaderRow([]);

    expect(result).toBeNull();
  });

  it('handles mixed-type cell values', async () => {
    const rows = [
      { index: 1, values: ['Fecha', 123, null, true] },
      { index: 2, values: ['01/01/2026', '100.50', 'Comida', 'si'] },
    ];

    const result = await adapter.detectHeaderRow(rows);

    expect(result).toBe(1);
  });

  it('skips leading rows that mix labels and data-like values if all non-empty cells are data-like', async () => {
    const rows = [
      { index: 1, values: ['Fecha', '100.50', 'USD'] },
      { index: 2, values: ['01/01/2026', '200.75', 'ARS'] },
    ];

    // Row 1 has "Fecha" but also data-like values, and not all non-empty cells are data-like,
    // so it should be detected as the header row.
    const result = await adapter.detectHeaderRow(rows);

    expect(result).toBe(1);
  });
});

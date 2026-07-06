// LAYER: Infrastructure / Tests
// Unit tests for LLMColumnInferenceAdapter.
// Mocks LLMPort.generateResponse and verifies JSON parsing, schema validation,
// deduplication, and graceful degradation.

import { describe, it, expect, vi } from 'vitest';
import { LLMColumnInferenceAdapter } from './LLMColumnInferenceAdapter';
import type { LLMPort } from '../../../domain/ports/services';

function buildMockLLMPort(response: string | (() => string) | Error): {
  port: LLMPort;
  generateResponse: ReturnType<typeof vi.fn>;
} {
  const generateResponse = vi.fn().mockImplementation(() => {
    if (response instanceof Error) {
      return Promise.reject(response);
    }
    return Promise.resolve(typeof response === 'function' ? response() : response);
  });
  return {
    port: {
      generateResponse,
      extractExpense: vi.fn(),
    },
    generateResponse,
  };
}

const sampleHeaders = ['Fecha', 'Monto', 'Categoría', 'Descripción'];
const sampleRows = [
  ['01/01/2026', '100.50', 'Comida', 'Almuerzo'],
  ['02/01/2026', '200.75', 'Transporte', 'Sube'],
];

describe('LLMColumnInferenceAdapter', () => {
  it('returns mappings from a valid JSON response', async () => {
    const { port } = buildMockLLMPort(
      JSON.stringify({
        mappings: [
          { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha', confidence: 'alta' },
          { gasttoField: 'monto', columnIndex: 1, columnHeader: 'Monto', confidence: 'alta' },
        ],
        noHeaderFound: false,
        unmappedFields: ['categoria', 'concepto', 'medio_pago', 'moneda'],
      }),
    );
    const adapter = new LLMColumnInferenceAdapter(port);

    const result = await adapter.infer(sampleHeaders, sampleRows);

    expect(result.mappings).toHaveLength(2);
    expect(result.mappings[0]).toEqual({
      gasttoField: 'fecha',
      columnIndex: 0,
      columnHeader: 'Fecha',
      confidence: 'alta',
    });
    expect(result.noHeaderFound).toBe(false);
    expect(result.unmappedFields).toEqual(['moneda', 'categoria', 'concepto', 'medio_pago']);
  });

  it('strips markdown code fences from the response', async () => {
    const { port } = buildMockLLMPort(
      '```json\n' +
        JSON.stringify({
          mappings: [
            { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha', confidence: 'alta' },
          ],
          noHeaderFound: false,
          unmappedFields: [],
        }) +
        '\n```',
    );
    const adapter = new LLMColumnInferenceAdapter(port);

    const result = await adapter.infer(sampleHeaders, sampleRows);

    expect(result.mappings).toHaveLength(1);
  });

  it('returns empty result when the LLM responds with noHeaderFound', async () => {
    const { port } = buildMockLLMPort(
      JSON.stringify({
        mappings: [],
        noHeaderFound: true,
        unmappedFields: ['fecha', 'monto', 'categoria', 'concepto', 'medio_pago', 'moneda'],
      }),
    );
    const adapter = new LLMColumnInferenceAdapter(port);

    const result = await adapter.infer(sampleHeaders, sampleRows);

    expect(result.mappings).toHaveLength(0);
    expect(result.noHeaderFound).toBe(true);
  });

  it('filters out mappings whose column index is outside the headers', async () => {
    const { port } = buildMockLLMPort(
      JSON.stringify({
        mappings: [
          { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha', confidence: 'alta' },
          { gasttoField: 'monto', columnIndex: 99, columnHeader: '?', confidence: 'alta' },
        ],
        noHeaderFound: false,
        unmappedFields: [],
      }),
    );
    const adapter = new LLMColumnInferenceAdapter(port);

    const result = await adapter.infer(sampleHeaders, sampleRows);

    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]?.gasttoField).toBe('fecha');
  });

  it('deduplicates mappings by field and column index', async () => {
    const { port } = buildMockLLMPort(
      JSON.stringify({
        mappings: [
          { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha', confidence: 'alta' },
          { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha', confidence: 'baja' },
          { gasttoField: 'monto', columnIndex: 1, columnHeader: 'Monto', confidence: 'alta' },
          { gasttoField: 'categoria', columnIndex: 1, columnHeader: 'Monto', confidence: 'alta' },
        ],
        noHeaderFound: false,
        unmappedFields: [],
      }),
    );
    const adapter = new LLMColumnInferenceAdapter(port);

    const result = await adapter.infer(sampleHeaders, sampleRows);

    expect(result.mappings).toHaveLength(2);
    expect(result.mappings.map((m) => m.gasttoField)).toEqual(
      expect.arrayContaining(['fecha', 'monto']),
    );
  });

  it('returns empty result when the LLM returns invalid JSON', async () => {
    const { port } = buildMockLLMPort('not valid json');
    const adapter = new LLMColumnInferenceAdapter(port);

    const result = await adapter.infer(sampleHeaders, sampleRows);

    expect(result.mappings).toHaveLength(0);
    expect(result.unmappedFields).toEqual([
      'monto',
      'moneda',
      'categoria',
      'fecha',
      'concepto',
      'medio_pago',
    ]);
  });

  it('returns empty result when the JSON does not match the expected schema', async () => {
    const { port } = buildMockLLMPort(JSON.stringify({ mappings: 'none' }));
    const adapter = new LLMColumnInferenceAdapter(port);

    const result = await adapter.infer(sampleHeaders, sampleRows);

    expect(result.mappings).toHaveLength(0);
  });

  it('returns empty result when the LLM call throws', async () => {
    const { port } = buildMockLLMPort(new Error('LLM timeout'));
    const adapter = new LLMColumnInferenceAdapter(port);

    const result = await adapter.infer(sampleHeaders, sampleRows);

    expect(result.mappings).toHaveLength(0);
  });

  it('returns empty result for empty headers without calling the LLM', async () => {
    const { port, generateResponse } = buildMockLLMPort(
      JSON.stringify({ mappings: [], noHeaderFound: true, unmappedFields: [] }),
    );
    const adapter = new LLMColumnInferenceAdapter(port);

    const result = await adapter.infer([], []);

    expect(result.mappings).toHaveLength(0);
    expect(result.noHeaderFound).toBe(true);
    expect(generateResponse).not.toHaveBeenCalled();
  });
});

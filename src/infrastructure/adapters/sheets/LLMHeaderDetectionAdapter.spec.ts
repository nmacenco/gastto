// LAYER: Infrastructure / Tests
// Unit tests for LLMHeaderDetectionAdapter.
// Mocks LLMPort.generateResponse and verifies JSON parsing, schema validation,
// and graceful degradation on invalid or unexpected LLM output.

import { describe, it, expect, vi } from 'vitest';
import { LLMHeaderDetectionAdapter } from './LLMHeaderDetectionAdapter';
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

const sampleRows = [
  { index: 1, values: ['Reporte de gastos', '', ''] },
  { index: 2, values: ['Generado el 01/01/2026', '', ''] },
  { index: 3, values: ['', '', ''] },
  { index: 4, values: ['Fecha', 'Monto', 'Categoría'] },
  { index: 5, values: ['05/01/2026', '150.00', 'Comida'] },
];

describe('LLMHeaderDetectionAdapter', () => {
  it('returns the header row index from a valid JSON response', async () => {
    const { port, generateResponse } = buildMockLLMPort('{"headerRowIndex": 4}');
    const adapter = new LLMHeaderDetectionAdapter(port);

    const result = await adapter.detectHeaderRow(sampleRows);

    expect(result).toBe(4);
    expect(generateResponse).toHaveBeenCalledTimes(1);
  });

  it('strips markdown code fences from the response', async () => {
    const { port } = buildMockLLMPort('```json\n{"headerRowIndex": 4}\n```');
    const adapter = new LLMHeaderDetectionAdapter(port);

    const result = await adapter.detectHeaderRow(sampleRows);

    expect(result).toBe(4);
  });

  it('returns null when the LLM responds with null', async () => {
    const { port } = buildMockLLMPort('{"headerRowIndex": null}');
    const adapter = new LLMHeaderDetectionAdapter(port);

    const result = await adapter.detectHeaderRow(sampleRows);

    expect(result).toBeNull();
  });

  it('returns null when the LLM returns invalid JSON', async () => {
    const { port } = buildMockLLMPort('not valid json');
    const adapter = new LLMHeaderDetectionAdapter(port);

    const result = await adapter.detectHeaderRow(sampleRows);

    expect(result).toBeNull();
  });

  it('returns null when the JSON does not match the expected schema', async () => {
    const { port } = buildMockLLMPort('{"row": 4}');
    const adapter = new LLMHeaderDetectionAdapter(port);

    const result = await adapter.detectHeaderRow(sampleRows);

    expect(result).toBeNull();
  });

  it('returns null when the returned index is outside the provided rows', async () => {
    const { port } = buildMockLLMPort('{"headerRowIndex": 99}');
    const adapter = new LLMHeaderDetectionAdapter(port);

    const result = await adapter.detectHeaderRow(sampleRows);

    expect(result).toBeNull();
  });

  it('returns null when the LLM call throws', async () => {
    const { port } = buildMockLLMPort(new Error('LLM timeout'));
    const adapter = new LLMHeaderDetectionAdapter(port);

    const result = await adapter.detectHeaderRow(sampleRows);

    expect(result).toBeNull();
  });

  it('returns null for an empty row list without calling the LLM', async () => {
    const { port, generateResponse } = buildMockLLMPort('{"headerRowIndex": 1}');
    const adapter = new LLMHeaderDetectionAdapter(port);

    const result = await adapter.detectHeaderRow([]);

    expect(result).toBeNull();
    expect(generateResponse).not.toHaveBeenCalled();
  });
});

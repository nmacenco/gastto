import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import { LLMExtractionError } from '../../../domain/errors/LLMExtractionError';
import type { LLMPort, UserContext } from '../../../domain/ports/services';
import { ExtractionFallbackLLMPort } from './ExtractionFallbackLLMPort';

const context: UserContext = {
  defaultCurrency: 'EUR',
  categories: [],
  categoryHierarchy: [],
  subcategoryEnabled: false,
  channel: 'telegram',
};
const expense: ExtractedExpense = {
  monto: 20.19,
  moneda: 'EUR',
  categoriaRaw: null,
  subcategoriaRaw: null,
  fechaRaw: '2026-10-21',
  medioPago: null,
  confianzaCategoria: 'nula',
  confianzaSubcategoria: 'nula',
};

function port(extractExpense: LLMPort['extractExpense']): LLMPort {
  return {
    extractExpense,
    interpretCorrection: vi.fn(),
    generateResponse: vi.fn(),
  };
}

describe('ExtractionFallbackLLMPort', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses another provider after a timeout within the original deadline', async () => {
    const primaryExtract = vi.fn().mockRejectedValue(new LLMExtractionError('LLM_TIMEOUT'));
    const fallbackExtract = vi.fn().mockResolvedValue(expense);
    const warn = vi.fn();
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1300);
    const adapter = new ExtractionFallbackLLMPort(
      port(primaryExtract),
      port(fallbackExtract),
      'nvidia',
      'openai',
      1000,
      { warn } as unknown as Logger,
    );

    await expect(
      adapter.extractExpense('Mercadona 20,19 €', context, { correlationId: 't:1' }),
    ).resolves.toEqual(expense);
    expect(primaryExtract).toHaveBeenCalledWith('Mercadona 20,19 €', context, {
      correlationId: 't:1',
      timeoutMs: 500,
    });
    expect(fallbackExtract).toHaveBeenCalledWith('Mercadona 20,19 €', context, {
      correlationId: 't:1',
      timeoutMs: 700,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'llm_extraction_fallback_started',
        provider: 'nvidia',
        fallbackProvider: 'openai',
        code: 'LLM_TIMEOUT',
      }),
    );
  });

  it('does not call the fallback after successful extraction or caller cancellation', async () => {
    const primaryExtract = vi.fn().mockResolvedValueOnce(expense);
    const fallbackExtract = vi.fn();
    const adapter = new ExtractionFallbackLLMPort(
      port(primaryExtract),
      port(fallbackExtract),
      'nvidia',
      'anthropic',
      1000,
      { warn: vi.fn() } as unknown as Logger,
    );
    await expect(adapter.extractExpense('gasto', context)).resolves.toEqual(expense);
    const signal = new AbortController();
    signal.abort();
    primaryExtract.mockRejectedValueOnce(new LLMExtractionError('LLM_CANCELLED'));
    await expect(
      adapter.extractExpense('gasto', context, { signal: signal.signal }),
    ).rejects.toMatchObject({
      code: 'LLM_CANCELLED',
    });
    expect(fallbackExtract).not.toHaveBeenCalled();
  });

  it('returns the fallback failure without a third attempt', async () => {
    const primaryExtract = vi.fn().mockRejectedValue(new LLMExtractionError('LLM_PROVIDER_ERROR'));
    const fallbackExtract = vi.fn().mockRejectedValue(new LLMExtractionError('LLM_INVALID_SCHEMA'));
    const adapter = new ExtractionFallbackLLMPort(
      port(primaryExtract),
      port(fallbackExtract),
      'nvidia',
      'openai',
      1000,
      { warn: vi.fn() } as unknown as Logger,
    );
    await expect(adapter.extractExpense('gasto', context)).rejects.toMatchObject({
      code: 'LLM_INVALID_SCHEMA',
    });
    expect(primaryExtract).toHaveBeenCalledTimes(1);
    expect(fallbackExtract).toHaveBeenCalledTimes(1);
  });
});

// LAYER: Infrastructure / Tests
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import type { LLMPort, UserContext } from '../../../domain/ports/services';
import { GroqAdapter } from './GroqAdapter';
import { ExtractionFallbackLLMPort } from './ExtractionFallbackLLMPort';

const { createMock, constructorMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  constructorMock: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
    constructor(config: unknown) {
      constructorMock(config);
    }
  },
}));

const context: UserContext = {
  defaultCurrency: 'EUR',
  categories: ['Alimentación', 'Transporte'],
  categoryHierarchy: [{ name: 'Alimentación', subcategories: ['Supermercado'] }],
  subcategoryEnabled: true,
  channel: 'telegram',
};
const expenseJson = {
  monto: 20.19,
  moneda: 'EUR',
  categoria_raw: 'Alimentación',
  subcategoria_raw: 'Supermercado',
  fecha_raw: '21 oct 2026',
  medio_pago: 'crédito',
  confianza_categoria: 'alta',
  confianza_subcategoria: 'alta',
};
const response = (content: unknown, finishReason = 'stop') => ({
  choices: [{ message: { content }, finish_reason: finishReason }],
  usage: { prompt_tokens: 100, completion_tokens: 50 },
});
const correctionTarget: ExtractedExpense = {
  monto: 20.19,
  moneda: 'EUR',
  categoriaRaw: 'Alimentación',
  subcategoriaRaw: 'Supermercado',
  fechaRaw: '21 oct 2026',
  medioPago: 'crédito',
  confianzaCategoria: 'alta',
  confianzaSubcategoria: 'alta',
};

describe('GroqAdapter', () => {
  beforeEach(() => {
    createMock.mockReset();
    constructorMock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('uses the independent Groq endpoint and validates a categorized expense', async () => {
    createMock.mockResolvedValue(response(JSON.stringify(expenseJson)));
    const adapter = new GroqAdapter('groq-test-key', 'openai/gpt-oss-20b');
    await expect(adapter.extractExpense('Mercadona 20,19 €', context)).resolves.toEqual(
      correctionTarget,
    );
    const [clientConfig] = constructorMock.mock.calls[0] as [
      { apiKey: string; baseURL: string; maxRetries: number; fetch: unknown },
    ];
    expect(clientConfig).toMatchObject({
      apiKey: 'groq-test-key',
      baseURL: 'https://api.groq.com/openai/v1',
      maxRetries: 0,
    });
    expect(typeof clientConfig.fetch).toBe('function');
    const [request, options] = createMock.mock.calls[0] as [
      { model: string; response_format: unknown; messages: Array<{ content: string }> },
      { signal: AbortSignal; maxRetries: number; timeout: number },
    ];
    expect(request.model).toBe('openai/gpt-oss-20b');
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request.messages[0]?.content).toContain('subcategoria_raw');
    expect(request.messages[1]?.content).toContain('"subcategoryEnabled": true');
    expect(request.messages[1]?.content).toContain('Supermercado');
    expect(options).toMatchObject({ maxRetries: 0, timeout: 30_000 });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes disabled subcategory context and accepts an explicit null', async () => {
    createMock.mockResolvedValue(
      response(
        JSON.stringify({
          ...expenseJson,
          subcategoria_raw: null,
          confianza_subcategoria: 'nula',
        }),
      ),
    );
    const disabled = { ...context, subcategoryEnabled: false };
    await expect(
      new GroqAdapter('key').extractExpense('Mercadona', disabled),
    ).resolves.toMatchObject({
      subcategoriaRaw: null,
      confianzaSubcategoria: 'nula',
    });
    const [request] = createMock.mock.calls[0] as [{ messages: Array<{ content: string }> }];
    expect(request.messages[1]?.content).toContain('"subcategoryEnabled": false');
  });

  it('classifies 429 without logging private provider data', async () => {
    const error = Object.assign(new Error('private provider response'), { status: 429 });
    createMock.mockRejectedValue(error);
    const loggerError = vi.fn();
    const logger = { info: vi.fn(), error: loggerError } as unknown as Logger;
    await expect(
      new GroqAdapter('private-key', undefined, { logger }).extractExpense(
        'private prompt',
        context,
      ),
    ).rejects.toMatchObject({ code: 'LLM_PROVIDER_ERROR' });
    const logged = JSON.stringify(loggerError.mock.calls);
    expect(logged).toContain('"httpStatus":429');
    expect(logged).not.toContain('private provider response');
    expect(logged).not.toContain('private prompt');
    expect(logged).not.toContain('private-key');
  });

  it.each([
    ['invalid JSON', 'not-json', 'stop', 'LLM_INVALID_JSON'],
    [
      'invalid schema',
      JSON.stringify({ ...expenseJson, monto: '20.19' }),
      'stop',
      'LLM_INVALID_SCHEMA',
    ],
    ['empty response', ' ', 'stop', 'LLM_EMPTY_RESPONSE'],
    ['truncated response', JSON.stringify(expenseJson), 'length', 'LLM_OUTPUT_TRUNCATED'],
  ])('classifies %s', async (_case, content, finishReason, code) => {
    createMock.mockResolvedValue(response(content, finishReason));
    await expect(new GroqAdapter('key').extractExpense('expense', context)).rejects.toMatchObject({
      code,
    });
  });

  it('times out while awaiting headers and aborts transport', async () => {
    let transportSignal: AbortSignal | undefined;
    createMock.mockImplementation((_request, options: { signal: AbortSignal }) => {
      transportSignal = options.signal;
      return new Promise(() => {});
    });
    await expect(
      new GroqAdapter('key').extractExpense('expense', context, { timeoutMs: 5 }),
    ).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(transportSignal?.aborted).toBe(true);
  });

  it('honors caller cancellation without waiting for transport completion', async () => {
    createMock.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = new GroqAdapter('key').extractExpense('expense', context, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
  });

  it('allows a typed Groq failure to use one alternate provider within the shared deadline', async () => {
    createMock.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    const fallbackExtract = vi.fn().mockResolvedValue(correctionTarget);
    const fallback: LLMPort = {
      extractExpense: fallbackExtract,
      interpretCorrection: vi.fn(),
      generateResponse: vi.fn(),
    };
    const adapter = new ExtractionFallbackLLMPort(
      new GroqAdapter('key'),
      fallback,
      'groq',
      'openai',
      1000,
      { warn: vi.fn() } as unknown as Logger,
    );
    await expect(adapter.extractExpense('Mercadona', context)).resolves.toEqual(correctionTarget);
    expect(createMock.mock.calls[0]?.[1]).toMatchObject({ timeout: 500, maxRetries: 0 });
    expect(fallbackExtract).toHaveBeenCalledOnce();
    const [, , fallbackOptions] = fallbackExtract.mock.calls[0] as [
      string,
      UserContext,
      { timeoutMs: number },
    ];
    expect(fallbackOptions.timeoutMs).toBeGreaterThan(0);
    expect(fallbackOptions.timeoutMs).toBeLessThanOrEqual(1000);
  });

  it('uses Groq for correction and response generation when selected as primary', async () => {
    createMock
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            intent: 'correction',
            changed_fields: ['monto'],
            monto: 15,
            moneda: null,
            categoria_raw: null,
            subcategoria_raw: null,
            fecha_raw: null,
          }),
        ),
      )
      .mockResolvedValueOnce(response('Hola'));
    const adapter = new GroqAdapter('key', 'openai/gpt-oss-20b');
    await expect(
      adapter.interpretCorrection('fueron 15', correctionTarget, context),
    ).resolves.toMatchObject({
      intent: 'correction',
      monto: 15,
    });
    await expect(
      adapter.generateResponse('Hola', {
        userId: 'user-1',
        currentState: 'IDLE',
        statePayload: null,
      }),
    ).resolves.toBe('Hola');
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({
      model: 'openai/gpt-oss-20b',
      response_format: { type: 'json_object' },
    });
    const [chatRequest] = createMock.mock.calls[1] as [{ model: string }];
    expect(chatRequest.model).toBe('openai/gpt-oss-20b');
  });
});

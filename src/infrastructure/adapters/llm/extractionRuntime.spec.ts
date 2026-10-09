import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { NvidiaAdapter } from './NvidiaAdapter';
import { OpenAIAdapter } from './OpenAIAdapter';
import { ClaudeAdapter } from './ClaudeAdapter';
import type { UserContext } from '../../../domain/ports/services';

const { openai, anthropic } = vi.hoisted(() => ({ openai: vi.fn(), anthropic: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: openai } };
  },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: anthropic };
  },
}));
const context: UserContext = {
  defaultCurrency: 'EUR',
  categories: [],
  categoryHierarchy: [],
  subcategoryEnabled: false,
  channel: 'telegram',
};
const valid = JSON.stringify({
  monto: 200,
  moneda: 'EUR',
  categoria_raw: 'Almuerzo',
  subcategoria_raw: null,
  fecha_raw: null,
  medio_pago: null,
  confianza_categoria: 'alta',
  confianza_subcategoria: 'nula',
});

function setup(provider: string, content: unknown = valid, finishReason?: string) {
  const info = vi.fn();
  const error = vi.fn();
  const settings = { timeoutMs: 1000, logger: { info, error } as unknown as Logger };
  const body = {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 12, completion_tokens: 34 },
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) });
  vi.stubGlobal('fetch', fetchMock);
  openai.mockResolvedValue(body);
  anthropic.mockResolvedValue({
    content: [{ type: 'text', text: content }],
    stop_reason: finishReason,
    usage: { input_tokens: 12, output_tokens: 34 },
  });
  const adapter =
    provider === 'nvidia'
      ? new NvidiaAdapter('test-only', 'test-model', settings)
      : provider === 'openai'
        ? new OpenAIAdapter('test-only', settings)
        : new ClaudeAdapter('test-only', settings);
  const request = provider === 'nvidia' ? fetchMock : provider === 'openai' ? openai : anthropic;
  return { adapter, info, error, request };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

for (const provider of ['nvidia', 'openai', 'anthropic']) {
  describe(`${provider} extraction boundary`, () => {
    it('extracts a reviewable expense and records safe correlated metadata once', async () => {
      const h = setup(provider, valid, 'stop');
      const expense = await h.adapter.extractExpense('almuerzo 200 euros', context, {
        correlationId: 'telegram:123',
      });
      expect(expense).toMatchObject({ monto: 200, moneda: 'EUR', categoriaRaw: 'Almuerzo' });
      expect(h.info).toHaveBeenCalledTimes(2);
      expect(h.info).toHaveBeenLastCalledWith(
        expect.objectContaining({
          event: 'llm_extraction_completed',
          correlationId: 'telegram:123',
          provider,
          durationMs: expect.any(Number) as number,
          finishReason: 'stop',
          inputTokens: 12,
          outputTokens: 34,
          outcome: 'success',
          timeoutMs: 1000,
        }),
      );
      expect(h.error).not.toHaveBeenCalled();
      if (provider !== 'nvidia')
        expect(h.request).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            maxRetries: 0,
            timeout: 1000,
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        );
    });

    it.each([
      [null, undefined, 'LLM_EMPTY_RESPONSE'],
      ['', undefined, 'LLM_EMPTY_RESPONSE'],
      ['   ', undefined, 'LLM_EMPTY_RESPONSE'],
      ['private broken JSON', undefined, 'LLM_INVALID_JSON'],
      ['{"monto":"private invalid value"}', undefined, 'LLM_INVALID_SCHEMA'],
      ['', 'length', 'LLM_OUTPUT_TRUNCATED'],
      [valid, 'max_tokens', 'LLM_OUTPUT_TRUNCATED'],
    ])('classifies unusable content %# without exposing it', async (content, reason, code) => {
      const h = setup(provider, content, reason);
      await expect(h.adapter.extractExpense('private user message', context)).rejects.toMatchObject(
        { code },
      );
      expect(h.error).toHaveBeenCalledTimes(1);
      expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ code, outcome: 'failure' }));
      expect(JSON.stringify(h.error.mock.calls)).not.toContain('private');
    });

    it('sanitizes SDK/transport errors and unknown finish reasons', async () => {
      const h = setup(provider, '', 'private provider text');
      await expect(h.adapter.extractExpense('private user message', context)).rejects.toMatchObject(
        { code: 'LLM_EMPTY_RESPONSE' },
      );
      expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ finishReason: 'unknown' }));
      h.request.mockRejectedValueOnce(new Error('private provider credentials'));
      await expect(h.adapter.extractExpense('private user message', context)).rejects.toMatchObject(
        { message: 'LLM_PROVIDER_ERROR' },
      );
      expect(JSON.stringify(h.error.mock.calls)).not.toContain('private');
    });

    it('aborts a stalled request at the deadline, ignores late completion, and cleans timers', async () => {
      vi.useFakeTimers();
      const h = setup(provider);
      let resolveRequest!: (value: unknown) => void;
      h.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      );
      const pending = h.adapter.extractExpense('almuerzo 200 euros', context);
      const checked = expect(pending).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(1000);
      await checked;
      if (provider === 'nvidia') {
        expect(h.error).toHaveBeenCalledWith(
          expect.objectContaining({
            phase: 'awaiting_headers',
            requestBytes: expect.any(Number) as number,
            timeoutMs: 1000,
          }),
        );
      }
      const options = h.request.mock.calls[0]?.[1] as { signal: AbortSignal };
      expect(options.signal.aborted).toBe(true);
      resolveRequest({});
      await Promise.resolve();
      expect(h.error).toHaveBeenCalledTimes(1);
      expect(h.info).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels on ownership loss and skips requests already cancelled', async () => {
      const h = setup(provider);
      h.request.mockImplementationOnce(() => new Promise(() => {}));
      const controller = new AbortController();
      const pending = h.adapter.extractExpense('almuerzo 200 euros', context, {
        signal: controller.signal,
      });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
      await expect(
        h.adapter.extractExpense('almuerzo 200 euros', context, { signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
      expect(h.request).toHaveBeenCalledTimes(1);
    });
  });
}

it('aborts NVIDIA while consuming the body and never reads an HTTP error body', async () => {
  vi.useFakeTimers();
  const h = setup('nvidia');
  h.request.mockResolvedValueOnce({ ok: true, status: 200, json: () => new Promise(() => {}) });
  const pending = h.adapter.extractExpense('almuerzo 200 euros', context);
  const checked = expect(pending).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(1000);
  await checked;
  expect((h.request.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  expect(h.error).toHaveBeenCalledWith(
    expect.objectContaining({ phase: 'reading_body', httpStatus: 200 }),
  );
  const readBody = vi.fn();
  h.request.mockResolvedValueOnce({ ok: false, status: 401, text: readBody });
  await expect(h.adapter.extractExpense('almuerzo 200 euros', context)).rejects.toMatchObject({
    code: 'LLM_PROVIDER_ERROR',
  });
  expect(readBody).not.toHaveBeenCalled();
  expect(h.error).toHaveBeenLastCalledWith(expect.objectContaining({ httpStatus: 401 }));
});

it('handles absent response structure and does not invent usage values', async () => {
  const h = setup('nvidia');
  h.request.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(null) });
  await expect(h.adapter.extractExpense('almuerzo 200 euros', context)).rejects.toMatchObject({
    code: 'LLM_EMPTY_RESPONSE',
  });
  expect(h.error.mock.calls[0]?.[0]).not.toHaveProperty('inputTokens');
  expect(h.error.mock.calls[0]?.[0]).not.toHaveProperty('outputTokens');
});

it('uses a bounded low-reasoning extraction request only for the documented GLM model', async () => {
  const h = setup('nvidia');
  await new NvidiaAdapter('test-only').extractExpense('almuerzo 200 euros', context);
  const first = h.request.mock.calls[0]?.[1] as RequestInit;
  expect(JSON.parse(first.body as string)).toMatchObject({
    model: 'z-ai/glm-5.3-flash',
    reasoning_effort: 'low',
    max_tokens: 4096,
    stream: false,
  });
  await new NvidiaAdapter('test-only', 'other/model').extractExpense('almuerzo 200 euros', context);
  const second = JSON.parse((h.request.mock.calls[1]?.[1] as RequestInit).body as string) as Record<
    string,
    unknown
  >;
  expect(second['max_tokens']).toBe(512);
  expect(second).not.toHaveProperty('reasoning_effort');
});

it('never interprets reasoning-only provider output as an expense', async () => {
  const h = setup('nvidia');
  h.request.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        choices: [
          { finish_reason: 'length', message: { content: null, reasoning_content: valid } },
        ],
        usage: { completion_tokens: 512 },
      }),
  });
  await expect(h.adapter.extractExpense('almuerzo 200 euros', context)).rejects.toMatchObject({
    code: 'LLM_OUTPUT_TRUNCATED',
  });
  expect(JSON.stringify(h.error.mock.calls)).not.toContain('Almuerzo');
});

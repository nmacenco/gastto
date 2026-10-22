// LAYER: Infrastructure / Tests
// Exercise the real OpenAI-compatible SDK against an HTTP boundary mock.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserContext } from '../../../domain/ports/services';
import { GroqAdapter } from './GroqAdapter';

const context: UserContext = {
  defaultCurrency: 'EUR',
  categories: ['Alimentación'],
  categoryHierarchy: [],
  subcategoryEnabled: false,
  channel: 'telegram',
};

describe('GroqAdapter HTTP body', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the strict extraction schema through the OpenAI-compatible HTTP client', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      requestBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'test-completion',
            object: 'chat.completion',
            created: 0,
            model: 'openai/gpt-oss-20b',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    monto: 20.19,
                    moneda: 'EUR',
                    categoria_raw: null,
                    subcategoria_raw: null,
                    fecha_raw: '21 oct 2026',
                    medio_pago: null,
                    confianza_categoria: 'nula',
                    confianza_subcategoria: 'nula',
                  }),
                },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new GroqAdapter('test-only').extractExpense('Mercadona 20,19 €', context),
    ).resolves.toMatchObject({ monto: 20.19, moneda: 'EUR' });

    expect(requestBody).toMatchObject({
      model: 'openai/gpt-oss-20b',
      response_format: { type: 'json_schema', json_schema: { strict: true } },
      reasoning_effort: 'low',
      max_completion_tokens: 1024,
    });
  });

  it('bounds response-body consumption and aborts the SDK fetch', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      return Promise.resolve(
        new Response(new ReadableStream({ start() {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new GroqAdapter('test-only').extractExpense('Mercadona 20 €', context, { timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(true);
  });
});

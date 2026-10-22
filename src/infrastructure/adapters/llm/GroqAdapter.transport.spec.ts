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

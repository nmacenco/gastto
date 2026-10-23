import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import {
  buildRouterCompletion,
  buildSemanticInput,
} from '../../../__tests__/factories/semantic-router';
import {
  OpenAISemanticRouterAdapter,
  type CompletionTransport,
  type OpenAIRouterSettings,
} from './OpenAISemanticRouterAdapter';

const settings: OpenAIRouterSettings = {
  model: 'gpt-4o-mini-2024-07-18',
  timeoutMs: 10000,
  maxOutputTokens: 256,
};
afterEach(() => vi.useRealTimers());
describe('OpenAI semantic router boundary', () => {
  it('requests exactly one strict decision, projects data verbatim and reports actual usage', async () => {
    const transport = vi.fn<CompletionTransport>().mockResolvedValue(buildRouterCompletion());
    const result = await new OpenAISemanticRouterAdapter(transport, settings).decide(
      buildSemanticInput(),
    );
    expect(result).toMatchObject({
      status: 'proposed',
      decision: { action: 'register_expense' },
      metadata: { inputTokens: 100, outputTokens: 10 },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    const [body, options] = transport.mock.calls[0]!;
    expect(body).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
          schema: { additionalProperties: false, required: ['decision'] },
        },
      },
      max_completion_tokens: 256,
      n: 1,
      stream: false,
      store: false,
    });
    expect(body).not.toHaveProperty('tools');
    expect(options).toMatchObject({
      maxRetries: 0,
      timeout: 10000,
      signal: expect.any(AbortSignal) as AbortSignal,
    });
    expect(JSON.parse(body.messages[1]!.content as string)).toEqual(buildSemanticInput());
    expect(JSON.stringify(body)).not.toContain('acceptedDecisions');
  });
  it.each([
    [
      'refusal',
      {
        choices: [
          {
            ...buildRouterCompletion().choices[0]!,
            message: { role: 'assistant', content: null, refusal: 'private provider text' },
          },
        ],
      },
      'MODEL_REFUSAL',
    ],
    [
      'truncation',
      { choices: [{ ...buildRouterCompletion().choices[0]!, finish_reason: 'length' }] },
      'OUTPUT_TOO_LARGE',
    ],
    [
      'filter',
      { choices: [{ ...buildRouterCompletion().choices[0]!, finish_reason: 'content_filter' }] },
      'MODEL_REFUSAL',
    ],
    ['missing', { choices: [] }, 'INVALID_OUTPUT'],
    [
      'tool',
      { choices: [{ ...buildRouterCompletion().choices[0]!, finish_reason: 'tool_calls' }] },
      'INVALID_OUTPUT',
    ],
  ])('safely handles %s', async (_, overrides, code) => {
    const transport = vi
      .fn<CompletionTransport>()
      .mockResolvedValue({ ...buildRouterCompletion(), ...overrides } as ChatCompletion);
    const result = await new OpenAISemanticRouterAdapter(transport, settings).decide(
      buildSemanticInput(),
    );
    expect(result).toMatchObject({ status: 'failed', code });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it.each([
    ['', 'INVALID_OUTPUT'],
    ['private invalid JSON', 'INVALID_OUTPUT'],
    ['{"decision":{"action":"confirm"}}', 'INVALID_OUTPUT'],
    ['{"decision":{"action":"register_expense","save":true}}', 'INVALID_OUTPUT'],
    ['{"decision":{"action":"select_option","userReference":""}}', 'INVALID_OUTPUT'],
    ['{"decision":{"action":"request_clarification","reason":"private"}}', 'INVALID_OUTPUT'],
    ['{"decision":{"action":"register_expense"},"private":true}', 'INVALID_OUTPUT'],
    ['x'.repeat(4001), 'OUTPUT_TOO_LARGE'],
  ])('rejects malformed/bounded content %#', async (content, code) => {
    const completion = buildRouterCompletion();
    completion.choices[0]!.message.content = content;
    const transport = vi.fn<CompletionTransport>().mockResolvedValue(completion);
    expect(
      await new OpenAISemanticRouterAdapter(transport, settings).decide(buildSemanticInput()),
    ).toMatchObject({ status: 'failed', code });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects input and configuration before contacting transport', async () => {
    const transport = vi.fn<CompletionTransport>();
    const adapter = new OpenAISemanticRouterAdapter(transport, settings);
    expect(await adapter.decide(null as never)).toMatchObject({ code: 'INVALID_INPUT' });
    expect(
      await adapter.decide({
        ...buildSemanticInput(),
        context: {
          ...buildSemanticInput().context,
          options: Array.from({ length: 21 }, (_, i) => ({ position: i + 1, label: 'Option' })),
        },
      }),
    ).toMatchObject({ code: 'INPUT_TOO_LARGE' });
    expect(
      await adapter.decide({ ...buildSemanticInput(), rawMessage: 'x'.repeat(8001) }),
    ).toMatchObject({ code: 'INPUT_TOO_LARGE' });
    expect(
      await adapter.decide({ ...buildSemanticInput(), allowedActions: ['request_save_retry'] }),
    ).toMatchObject({ code: 'INVALID_INPUT' });
    expect(
      await adapter.decide({ ...buildSemanticInput(), acceptedDecisions: [] } as never),
    ).toMatchObject({ code: 'INVALID_INPUT' });
    expect(
      await new OpenAISemanticRouterAdapter(transport, { ...settings, timeoutMs: Infinity }).decide(
        buildSemanticInput(),
      ),
    ).toMatchObject({ code: 'UNSUPPORTED_CONFIGURATION' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('enforces a deadline and propagates cancellation even when a transport never resolves', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<CompletionTransport>(() => new Promise(() => {}));
    const pending = new OpenAISemanticRouterAdapter(transport, settings).decide(
      buildSemanticInput(),
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ status: 'failed', code: 'TIMEOUT' });
    expect(transport.mock.calls[0]![1].signal?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([400, 401, 404, 422, 429, 500])(
    'maps HTTP %i without retry or response leakage',
    async (status) => {
      const transport = vi
        .fn<CompletionTransport>()
        .mockRejectedValue(
          new OpenAI.APIError(
            status,
            { message: 'private financial text' },
            'private financial text',
            {},
          ),
        );
      const result = await new OpenAISemanticRouterAdapter(transport, settings).decide(
        buildSemanticInput(),
      );
      expect(result).toMatchObject({
        code: [400, 404, 422].includes(status) ? 'UNSUPPORTED_CONFIGURATION' : 'PROVIDER_ERROR',
      });
      expect(JSON.stringify(result)).not.toContain('private');
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps absent usage null and lets policy distinguish valid forbidden actions', async () => {
    const completion: ChatCompletion = buildRouterCompletion();
    delete completion.usage;
    completion.choices[0]!.message.content = '{"decision":{"action":"request_save_retry"}}';
    const transport = vi.fn<CompletionTransport>().mockResolvedValue(completion);
    expect(
      await new OpenAISemanticRouterAdapter(transport, settings).decide(buildSemanticInput()),
    ).toMatchObject({
      status: 'proposed',
      decision: { action: 'request_save_retry' },
      metadata: { inputTokens: null, outputTokens: null },
    });
  });
  it.each([new Error('private network error'), new OpenAI.APIConnectionTimeoutError()])(
    'maps network/SDK timeout safely',
    async (error) => {
      const transport = vi.fn<CompletionTransport>().mockRejectedValue(error);
      const result = await new OpenAISemanticRouterAdapter(transport, settings).decide(
        buildSemanticInput(),
      );
      expect(result).toMatchObject({
        code: error instanceof OpenAI.APIConnectionTimeoutError ? 'TIMEOUT' : 'PROVIDER_ERROR',
      });
      expect(JSON.stringify(result)).not.toContain('private');
    },
  );
});

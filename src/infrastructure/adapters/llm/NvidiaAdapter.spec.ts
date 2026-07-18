// LAYER: Infrastructure / Tests
// Contract tests for NvidiaAdapter.
// Mocks the global fetch API so no real NVIDIA calls are made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NvidiaAdapter } from './NvidiaAdapter';
import type { UserContext, ConversationContext } from '../../../domain/ports/services';

const API_KEY = 'nvidia-test-key';

const userContext: UserContext = {
  defaultCurrency: 'ARS',
  categories: ['Comida', 'Transporte'],
  channel: 'telegram',
};

const conversationContext: ConversationContext = {
  userId: 'user-123',
  currentState: 'ONBOARDING_MAPPING',
  statePayload: null,
};

function buildNvidiaResponse(content: string): unknown {
  return {
    choices: [
      {
        message: {
          content,
        },
      },
    ],
  };
}

type NvidiaRequestBody = {
  model: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
  stream: boolean;
  messages: Array<{ role: string; content: string }>;
};

describe('NvidiaAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractExpense', () => {
    it('extracts an expense from a successful JSON response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            buildNvidiaResponse(
              JSON.stringify({
                monto: 1500,
                moneda: 'ARS',
                categoria_raw: 'Comida',
                fecha_raw: 'hoy',
                medio_pago: 'efectivo',
                confianza_categoria: 'alta',
              }),
            ),
          ),
      });

      const adapter = new NvidiaAdapter(API_KEY);
      const result = await adapter.extractExpense(
        'Gasté 1500 pesos en comida hoy en efectivo',
        userContext,
      );

      expect(result).toEqual({
        monto: 1500,
        moneda: 'ARS',
        categoriaRaw: 'Comida',
        fechaRaw: 'hoy',
        medioPago: 'efectivo',
        confianzaCategoria: 'alta',
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(init.body as string) as NvidiaRequestBody;
      expect(body.model).toBe('minimaxai/minimax-m3');
      expect(body.temperature).toBe(0);
      expect(body.stream).toBe(false);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[1]).toEqual({
        role: 'user',
        content: 'Gasté 1500 pesos en comida hoy en efectivo',
      });
    });

    it('strips markdown fences from the JSON response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            buildNvidiaResponse(
              '```json\n' +
                JSON.stringify({
                  monto: 200,
                  moneda: null,
                  categoria_raw: null,
                  fecha_raw: null,
                  medio_pago: null,
                  confianza_categoria: 'nula',
                }) +
                '\n```',
            ),
          ),
      });

      const adapter = new NvidiaAdapter(API_KEY);
      const result = await adapter.extractExpense('200', userContext);

      expect(result.monto).toBe(200);
      expect(result.confianzaCategoria).toBe('nula');
    });

    it('throws when the API returns an HTTP error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('invalid x-api-key'),
      });

      const adapter = new NvidiaAdapter(API_KEY);
      await expect(adapter.extractExpense('test', userContext)).rejects.toThrow(
        'NVIDIA API error 401: invalid x-api-key',
      );
    });

    it('throws when the response content is empty', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: null } }] }),
      });

      const adapter = new NvidiaAdapter(API_KEY);
      await expect(adapter.extractExpense('test', userContext)).rejects.toThrow(
        'LLM returned empty response',
      );
    });

    it('throws when the response is not valid JSON', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(buildNvidiaResponse('not json')),
      });

      const adapter = new NvidiaAdapter(API_KEY);
      await expect(adapter.extractExpense('test', userContext)).rejects.toThrow(SyntaxError);
    });

    it('throws when the response JSON does not match the schema', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            buildNvidiaResponse(
              JSON.stringify({
                monto: 'not a number',
                moneda: 'ARS',
                categoria_raw: 'Comida',
                fecha_raw: 'hoy',
                medio_pago: 'efectivo',
                confianza_categoria: 'alta',
              }),
            ),
          ),
      });

      const adapter = new NvidiaAdapter(API_KEY);
      await expect(adapter.extractExpense('test', userContext)).rejects.toThrow();
    });
  });

  describe('generateResponse', () => {
    it('returns the assistant text from a successful response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(buildNvidiaResponse('Hola, ¿en qué puedo ayudarte?')),
      });

      const adapter = new NvidiaAdapter(API_KEY);
      const result = await adapter.generateResponse('Responde saludando', conversationContext);

      expect(result).toBe('Hola, ¿en qué puedo ayudarte?');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
      const body = JSON.parse(init.body as string) as NvidiaRequestBody;
      expect(body.messages).toEqual([{ role: 'user', content: 'Responde saludando' }]);
      expect(body.temperature).toBe(0.3);
    });

    it('returns an empty string when the response content is missing', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{}] }),
      });

      const adapter = new NvidiaAdapter(API_KEY);
      const result = await adapter.generateResponse('test', conversationContext);

      expect(result).toBe('');
    });

    it('throws when the API returns an HTTP error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('internal server error'),
      });

      const adapter = new NvidiaAdapter(API_KEY);
      await expect(adapter.generateResponse('test', conversationContext)).rejects.toThrow(
        'NVIDIA API error 500: internal server error',
      );
    });
  });
});

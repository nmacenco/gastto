// LAYER: Infrastructure / Tests
// Contract tests for TelegramMessengerAdapter.
// Mocks the global fetch API so no real Telegram calls are made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';
import { TelegramMessengerAdapter } from './TelegramMessengerAdapter';

const BOT_TOKEN = 'test-token-123';
const CHAT_ID = '987654321';

interface TelegramSendMessageBody {
  chat_id: string;
  text: string;
  parse_mode?: string;
}

describe('TelegramMessengerAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const mockLoggerInfo = vi.fn();
  const mockLoggerError = vi.fn();
  const mockLogger = { info: mockLoggerInfo, error: mockLoggerError } as unknown as Logger;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('sendMessage', () => {
    it('calls Telegram /sendMessage with correct payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      const result = await adapter.sendMessage(CHAT_ID, 'Hello world');

      expect(result).toEqual({ status: 'success' });
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string) as TelegramSendMessageBody;
      expect(body.chat_id).toBe(CHAT_ID);
      expect(body.text).toBe('Hello world');
      expect(body.parse_mode).toBeUndefined();
    });

    it('returns success when Telegram responds with ok: true', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      const result = await adapter.sendMessage(CHAT_ID, 'Hello world');

      expect(result).toEqual({ status: 'success' });
    });

    it('returns failure when Telegram responds with HTTP error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      const result = await adapter.sendMessage(CHAT_ID, 'test');

      expect(result).toEqual({ status: 'failure', errorCode: 'SEND_FAILED' });
    });

    it('returns failure when Telegram JSON response has ok: false', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'Bad Request: chat not found' }),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      const result = await adapter.sendMessage(CHAT_ID, 'test');

      expect(result).toEqual({ status: 'failure', errorCode: 'TELEGRAM_API_ERROR' });
    });

    it('splits long messages into chunks and sends them sequentially', async () => {
      const longText = 'A'.repeat(4096) + 'B'.repeat(100);

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      const result = await adapter.sendMessage(CHAT_ID, longText);

      expect(result).toEqual({ status: 'success' });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const firstBody = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as TelegramSendMessageBody;
      const secondBody = JSON.parse(
        (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
      ) as TelegramSendMessageBody;

      expect(firstBody.text.length).toBe(4096);
      expect(secondBody.text).toBe('B'.repeat(100));

      const chunkLog = mockLoggerInfo.mock.calls.find(
        (call) => (call[0] as { event?: string }).event === 'message_chunked',
      );
      expect(chunkLog).toBeDefined();
      expect(chunkLog![0]).toMatchObject({
        event: 'message_chunked',
        chatId: CHAT_ID,
        originalLength: longText.length,
        fragmentCount: 2,
      });
    });

    it('stops sending remaining fragments when a fragment fails permanently', async () => {
      const longText = 'A'.repeat(4096) + 'B'.repeat(100);

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: () => Promise.resolve('Forbidden'),
        });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      const result = await adapter.sendMessage(CHAT_ID, longText);

      expect(result).toEqual({ status: 'failure', errorCode: 'PERMANENT_FAILURE' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry logic', () => {
    it('retries 3 times on HTTP 5xx with correct delays, then returns MAX_RETRIES_EXCEEDED', async () => {
      vi.useFakeTimers();

      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      const sendPromise = adapter.sendMessage(CHAT_ID, 'test');

      // Initial attempt + 3 retries = 4 calls total
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(4000);
      expect(fetchMock).toHaveBeenCalledTimes(4);

      const result = await sendPromise;
      expect(result).toEqual({ status: 'failure', errorCode: 'MAX_RETRIES_EXCEEDED' });

      const retryLogs = mockLoggerInfo.mock.calls.filter(
        (call) => (call[0] as { event?: string }).event === 'retry_scheduled',
      );
      expect(retryLogs).toHaveLength(3);
      expect(retryLogs[0]![0]).toMatchObject({ attempt: 1, delayMs: 1000 });
      expect(retryLogs[1]![0]).toMatchObject({ attempt: 2, delayMs: 2000 });
      expect(retryLogs[2]![0]).toMatchObject({ attempt: 3, delayMs: 4000 });
    });

    it('returns PERMANENT_FAILURE immediately on HTTP 400 with no retries', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      const result = await adapter.sendMessage(CHAT_ID, 'test');

      expect(result).toEqual({ status: 'failure', errorCode: 'PERMANENT_FAILURE' });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const errorLog = mockLoggerError.mock.calls.find(
        (call) => (call[0] as { event?: string }).event === 'message_send_failed',
      );
      expect(errorLog).toBeDefined();
      expect(errorLog![0]).toMatchObject({
        event: 'message_send_failed',
        chatId: CHAT_ID,
        errorCode: 'PERMANENT_FAILURE',
        reason: 'HTTP 400',
      });
    });

    it('returns PERMANENT_FAILURE immediately on HTTP 403 with no retries', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      const result = await adapter.sendMessage(CHAT_ID, 'test');

      expect(result).toEqual({ status: 'failure', errorCode: 'PERMANENT_FAILURE' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('succeeds on the second retry attempt', async () => {
      vi.useFakeTimers();

      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          text: () => Promise.resolve('Bad Gateway'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: () => Promise.resolve('Service Unavailable'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      const sendPromise = adapter.sendMessage(CHAT_ID, 'test');

      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      const result = await sendPromise;
      expect(result).toEqual({ status: 'success' });

      const successLog = mockLoggerInfo.mock.calls.find(
        (call) =>
          (call[0] as { event?: string; result?: string }).event === 'message_sent' &&
          (call[0] as { result?: string }).result === 'success',
      );
      expect(successLog).toBeDefined();
      expect(successLog![0]).toMatchObject({ attempt: 3, result: 'success' });
    });
  });

  describe('logging', () => {
    it('logs message_sent on successful send', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      await adapter.sendMessage(CHAT_ID, 'Hello world');

      const sentLog = mockLoggerInfo.mock.calls.find(
        (call) => (call[0] as { event?: string }).event === 'message_sent',
      );
      expect(sentLog).toBeDefined();
      expect(sentLog![0]).toMatchObject({
        event: 'message_sent',
        chatId: CHAT_ID,
        textLength: 'Hello world'.length,
        attempt: 1,
        result: 'success',
      });
    });

    it('logs message_sent with failure result on HTTP 401', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      await adapter.sendMessage(CHAT_ID, 'test');

      const sentLog = mockLoggerInfo.mock.calls.find(
        (call) => (call[0] as { event?: string }).event === 'message_sent',
      );
      expect(sentLog).toBeDefined();
      expect(sentLog![0]).toMatchObject({
        event: 'message_sent',
        result: 'failure',
        errorCode: 'SEND_FAILED',
      });
    });
  });

  describe('sendWelcome', () => {
    it('sends a personalized welcome message when username is provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      await adapter.sendWelcome(CHAT_ID, 'María');

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as TelegramSendMessageBody;
      expect(body.text).toContain('¡Hola, María!');
    });

    it('sends a generic welcome message when no username is provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN, mockLogger);
      await adapter.sendWelcome(CHAT_ID);

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as TelegramSendMessageBody;
      expect(body.text).toContain('¡Hola!');
      expect(body.text).not.toContain('undefined');
    });
  });
});

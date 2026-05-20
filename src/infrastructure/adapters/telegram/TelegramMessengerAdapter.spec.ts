// LAYER: Infrastructure / Tests
// Contract tests for TelegramMessengerAdapter.
// Mocks the global fetch API so no real Telegram calls are made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendMessage', () => {
    it('calls Telegram /sendMessage with correct payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN);
      await adapter.sendMessage(CHAT_ID, 'Hello world');

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string) as TelegramSendMessageBody;
      expect(body.chat_id).toBe(CHAT_ID);
      expect(body.text).toBe('Hello world');
      expect(body.parse_mode).toBeUndefined();
    });

    it('includes parse_mode when options specify Markdown', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN);
      await adapter.sendMessage(CHAT_ID, '**bold**', { parseMode: 'Markdown' });

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as TelegramSendMessageBody;
      expect(body.parse_mode).toBe('Markdown');
    });

    it('throws when Telegram responds with HTTP error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN);
      await expect(adapter.sendMessage(CHAT_ID, 'test')).rejects.toThrow('401');
    });

    it('throws when Telegram JSON response has ok: false', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'Bad Request: chat not found' }),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN);
      await expect(adapter.sendMessage(CHAT_ID, 'test')).rejects.toThrow(
        'Bad Request: chat not found',
      );
    });
  });

  describe('sendWelcome', () => {
    it('sends a personalized welcome message when username is provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN);
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

      const adapter = new TelegramMessengerAdapter(BOT_TOKEN);
      await adapter.sendWelcome(CHAT_ID);

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as TelegramSendMessageBody;
      expect(body.text).toContain('¡Hola!');
      expect(body.text).not.toContain('undefined');
    });
  });
});

// LAYER: Infrastructure / Tests
// Contract tests for TelegramWebhookConfigurator.
// Mocks the global fetch API so no real Telegram calls are made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramWebhookConfigurator, type WebhookInfo } from './TelegramWebhookConfigurator';

const BOT_TOKEN = 'test-token-456';

interface TelegramSetWebhookBody {
  url: string;
  secret_token: string;
}

describe('TelegramWebhookConfigurator', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setWebhook', () => {
    it('returns true when Telegram responds with ok: true', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: true }),
      });

      const configurator = new TelegramWebhookConfigurator(BOT_TOKEN);
      const result = await configurator.setWebhook('https://example.com/webhook', 'my-secret');

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`);
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string) as TelegramSetWebhookBody;
      expect(body.url).toBe('https://example.com/webhook');
      expect(body.secret_token).toBe('my-secret');
    });

    it('throws on HTTP error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      });

      const configurator = new TelegramWebhookConfigurator(BOT_TOKEN);
      await expect(
        configurator.setWebhook('https://example.com/webhook', 'secret'),
      ).rejects.toThrow('404');
    });

    it('throws when Telegram JSON has ok: false', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'Invalid bot token' }),
      });

      const configurator = new TelegramWebhookConfigurator(BOT_TOKEN);
      await expect(
        configurator.setWebhook('https://example.com/webhook', 'secret'),
      ).rejects.toThrow('Invalid bot token');
    });
  });

  describe('getWebhookInfo', () => {
    it('returns parsed WebhookInfo on success', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            result: {
              url: 'https://example.com/webhook',
              has_custom_certificate: false,
              pending_update_count: 0,
              ip_address: '1.2.3.4',
              last_error_date: 1715000000,
              last_error_message: '',
              max_connections: 40,
              allowed_updates: ['message'],
            },
          }),
      });

      const configurator = new TelegramWebhookConfigurator(BOT_TOKEN);
      const info: WebhookInfo = await configurator.getWebhookInfo();

      expect(info.url).toBe('https://example.com/webhook');
      expect(info.hasCustomCertificate).toBe(false);
      expect(info.pendingUpdateCount).toBe(0);
      expect(info.ipAddress).toBe('1.2.3.4');
      expect(info.lastErrorDate).toBe(1715000000);
      expect(info.maxConnections).toBe(40);
      expect(info.allowedUpdates).toEqual(['message']);
    });

    it('throws on HTTP error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const configurator = new TelegramWebhookConfigurator(BOT_TOKEN);
      await expect(configurator.getWebhookInfo()).rejects.toThrow('500');
    });

    it('throws when Telegram JSON has ok: false', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'Not supported' }),
      });

      const configurator = new TelegramWebhookConfigurator(BOT_TOKEN);
      await expect(configurator.getWebhookInfo()).rejects.toThrow('Not supported');
    });
  });
});

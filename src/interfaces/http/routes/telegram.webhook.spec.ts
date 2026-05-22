// LAYER: Interfaces / Tests
// Contract tests for the Telegram webhook route (refactored).
// The route now delegates parsing to TelegramPayloadParser and
// business logic to RouteIncomingMessage use case.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { RouteIncomingMessage } from '../../../application/use-cases/conversation/RouteIncomingMessage';
import type { HandleStartCommand } from '../../../application/use-cases/conversation/HandleStartCommand';
import { registerTelegramWebhook, type TelegramWebhookDeps } from './telegram.webhook';

const WEBHOOK_SECRET = 'test-secret-token';

const mockRouteExecute = vi.fn();
const mockHandleStartExecute = vi.fn();

function buildMockDeps(): TelegramWebhookDeps {
  mockRouteExecute.mockResolvedValue(undefined);
  mockHandleStartExecute.mockResolvedValue({ replyText: 'Welcome!' });

  return {
    webhookSecret: WEBHOOK_SECRET,
    routeIncomingMessage: { execute: mockRouteExecute } as unknown as RouteIncomingMessage,
    handleStartCommand: { execute: mockHandleStartExecute } as unknown as HandleStartCommand,
  };
}

function buildApp(deps: TelegramWebhookDeps = buildMockDeps()) {
  const app = Fastify({ logger: false });
  registerTelegramWebhook(app, deps);
  return { app, deps };
}

function makeValidPayload(
  overrides: { text?: string | undefined; noMessage?: boolean; username?: string } = {},
) {
  if (overrides.noMessage) {
    return { update_id: 1 };
  }
  return {
    update_id: 1,
    message: {
      message_id: 42,
      from: { id: 999, ...(overrides.username !== undefined && { username: overrides.username }) },
      chat: { id: 123456789 },
      text: 'text' in overrides ? overrides.text : 'Cafe con leche 850',
      date: Math.floor(Date.now() / 1000),
    },
  };
}

describe('POST /webhook/telegram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns HTTP 200 and delegates a valid text message to the router', async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      payload: makeValidPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });

    expect(mockRouteExecute).toHaveBeenCalledTimes(1);
    expect(mockHandleStartExecute).not.toHaveBeenCalled();
  });

  it('returns HTTP 200 for unparseable payload and delegates to router', async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      payload: { invalid: 'data' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });

    expect(mockRouteExecute).toHaveBeenCalledTimes(1);
    expect(mockHandleStartExecute).not.toHaveBeenCalled();
  });

  it('returns HTTP 200 for payload without message and delegates to router', async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      payload: makeValidPayload({ noMessage: true }),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });

    expect(mockRouteExecute).toHaveBeenCalledTimes(1);
    expect(mockHandleStartExecute).not.toHaveBeenCalled();
  });

  it('returns HTTP 200 for non-text messages and delegates to router', async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      payload: makeValidPayload({ text: undefined }),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });

    expect(mockRouteExecute).toHaveBeenCalledTimes(1);
    expect(mockHandleStartExecute).not.toHaveBeenCalled();
  });

  it('triggers HandleStartCommand for /start without routing', async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      payload: makeValidPayload({ text: '/start', username: 'Juan' }),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });

    expect(mockHandleStartExecute).toHaveBeenCalledWith({
      chatId: '123456789',
      username: 'Juan',
    });

    expect(mockRouteExecute).not.toHaveBeenCalled();
  });

  it('triggers HandleStartCommand for /START (case-insensitive)', async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      payload: makeValidPayload({ text: '/START' }),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });

    expect(mockHandleStartExecute).toHaveBeenCalledWith({
      chatId: '123456789',
      username: undefined,
    });

    expect(mockRouteExecute).not.toHaveBeenCalled();
  });

  it('triggers HandleStartCommand for /start with surrounding whitespace', async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      payload: makeValidPayload({ text: '  /start  ' }),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });

    expect(mockHandleStartExecute).toHaveBeenCalledWith({
      chatId: '123456789',
      username: undefined,
    });

    expect(mockRouteExecute).not.toHaveBeenCalled();
  });
});

// LAYER: Interfaces / Tests
// Contract tests for the Telegram webhook route.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { Queue } from 'bullmq';
import type { ResolveUserIdentityUseCase } from '../../../application/use-cases/user/ResolveUserIdentity';
import {
  registerTelegramWebhook,
  type ProcessMessageJobData,
  type TelegramWebhookDeps,
} from './telegram.webhook';

const WEBHOOK_SECRET = 'test-secret-token';

const mockExecute = vi.fn();
const mockAdd = vi.fn();
const mockSendMessage = vi.fn();

function buildMockDeps(): TelegramWebhookDeps {
  mockExecute.mockResolvedValue({
    userId: 'user-123',
    isNewUser: false,
    currentState: 'IDLE',
  });
  mockAdd.mockResolvedValue(undefined);
  mockSendMessage.mockResolvedValue(undefined);

  return {
    webhookSecret: WEBHOOK_SECRET,
    messageQueue: { add: mockAdd } as unknown as Queue<ProcessMessageJobData>,
    resolveIdentity: { execute: mockExecute } as unknown as ResolveUserIdentityUseCase,
    telegramMessaging: { sendMessage: mockSendMessage },
  };
}

function buildApp(deps: TelegramWebhookDeps = buildMockDeps()) {
  const app = Fastify({ logger: false });
  registerTelegramWebhook(app, deps);
  return { app, deps };
}

function makeValidPayload(overrides: { text?: string | undefined; noMessage?: boolean } = {}) {
  if (overrides.noMessage) {
    return { update_id: 1 };
  }
  return {
    update_id: 1,
    message: {
      message_id: 42,
      from: { id: 999 },
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

  it('returns HTTP 200 and processes a valid text message', async () => {
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

    expect(mockExecute).toHaveBeenCalledWith({
      channel: 'telegram',
      externalId: '123456789',
    });

    expect(mockAdd).toHaveBeenCalledOnce();
    const [, jobData] = mockAdd.mock.calls[0] as [string, ProcessMessageJobData];
    expect(jobData).toMatchObject({
      userId: 'user-123',
      rawMessage: 'Cafe con leche 850',
      channel: 'telegram',
      externalId: '123456789',
    });
    expect(new Date(jobData.receivedAt).getTime()).toBeGreaterThan(0);

    expect(mockSendMessage).toHaveBeenCalledWith('123456789', 'Recibido, procesando tu gasto…');
  });

  it('returns HTTP 200 for unparseable payload without enqueuing', async () => {
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

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns HTTP 200 for payload without message and does not enqueue', async () => {
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

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns HTTP 200 for non-text messages and sends fallback text', async () => {
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

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456789',
      'Por ahora solo proceso mensajes de texto. Contame tu gasto escribiendolo.',
    );
  });
});

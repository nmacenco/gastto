// LAYER: Interfaces / Tests
// Contract tests for the Telegram webhook route (refactored for ADR-011).
// The route now enqueues to incoming-message queue, handles MALFORMED at
// the route layer, and short-circuits /start synchronously.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Queue } from 'bullmq';
import type { HandleStartCommand } from '../../../application/use-cases/conversation/HandleStartCommand';
import type { SendImmediateAcknowledgement } from '../../../application/use-cases/conversation/SendImmediateAcknowledgement';
import type { ResolveUserIdentityUseCase } from '../../../application/use-cases/user/ResolveUserIdentity';
import type { IncomingMessageJobData } from '../../../application/ports/IncomingMessageJob';
import { registerTelegramWebhook, type TelegramWebhookDeps } from './telegram.webhook';

const WEBHOOK_SECRET = 'test-secret-token';

const mockQueueAdd = vi.fn();
const mockHandleStartExecute = vi.fn();
const mockSendAckExecute = vi.fn();
const mockResolveIdentityExecute = vi.fn();
const mockLogError = vi.fn();

function buildMockDeps(): TelegramWebhookDeps {
  mockQueueAdd.mockResolvedValue(undefined);
  mockHandleStartExecute.mockResolvedValue({ replyText: 'Welcome!' });
  mockResolveIdentityExecute.mockResolvedValue({
    userId: 'user-123',
    isNewUser: false,
    currentState: 'IDLE',
  });
  mockLogError.mockReset();

  return {
    webhookSecret: WEBHOOK_SECRET,
    incomingMessageQueue: { add: mockQueueAdd } as unknown as Queue<IncomingMessageJobData>,
    handleStartCommand: { execute: mockHandleStartExecute } as unknown as HandleStartCommand,
    sendImmediateAcknowledgement: {
      execute: mockSendAckExecute,
    } as unknown as SendImmediateAcknowledgement,
    resolveIdentity: {
      execute: mockResolveIdentityExecute,
    } as unknown as ResolveUserIdentityUseCase,
  };
}

function buildApp(deps: TelegramWebhookDeps = buildMockDeps()) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Inject mock logger so we can assert on req.log.error
  // eslint-disable-next-line @typescript-eslint/require-await
  app.addHook('preHandler', async (req) => {
    (req as unknown as Record<string, unknown>).log = {
      error: mockLogError,
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
  });
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
    mockSendAckExecute.mockResolvedValue({ status: 'success' });
  });

  it('returns HTTP 200 and enqueues a valid text message to the incoming-message queue', async () => {
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

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const [, jobData] = mockQueueAdd.mock.calls[0] as [string, IncomingMessageJobData];
    expect(jobData.messageType).toBe('TEXT');
    expect(jobData.chatId).toBe('123456789');
    expect(jobData.text).toBe('Cafe con leche 850');
    expect(jobData.channel).toBe('telegram');
    expect(jobData.externalMessageId).toBe('42');
    expect(typeof jobData.timestamp).toBe('string');
    expect(mockHandleStartExecute).not.toHaveBeenCalled();
    expect(mockSendAckExecute).toHaveBeenCalledTimes(1);
    expect(mockSendAckExecute).toHaveBeenCalledWith({
      chatId: '123456789',
      channel: 'telegram',
      userId: '999',
    });
  });

  it('returns HTTP 200 for unparseable payload and logs MALFORMED error without enqueueing', async () => {
    const { app } = buildApp();

    const rawPayload = { invalid: 'data' };
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      payload: rawPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });

    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith({
      endpoint: '/webhook/telegram',
      code: 'MALFORMED_PAYLOAD',
      rawPayload,
    });

    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockHandleStartExecute).not.toHaveBeenCalled();
    expect(mockSendAckExecute).not.toHaveBeenCalled();
  });

  it('returns HTTP 200 for payload without message and logs MALFORMED error without enqueueing', async () => {
    const { app } = buildApp();

    const rawPayload = makeValidPayload({ noMessage: true });
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      payload: rawPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });

    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith({
      endpoint: '/webhook/telegram',
      code: 'MALFORMED_PAYLOAD',
      rawPayload,
    });

    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockHandleStartExecute).not.toHaveBeenCalled();
    expect(mockSendAckExecute).not.toHaveBeenCalled();
  });

  it('returns HTTP 200 for non-text messages and enqueues as UNSUPPORTED', async () => {
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

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const [, jobData] = mockQueueAdd.mock.calls[0] as [string, IncomingMessageJobData];
    expect(jobData.messageType).toBe('UNSUPPORTED');
    expect(jobData.chatId).toBe('123456789');
    expect(jobData.externalMessageId).toBe('42');
    expect(mockHandleStartExecute).not.toHaveBeenCalled();
    expect(mockSendAckExecute).not.toHaveBeenCalled();
  });

  it('enqueues 3 rapid text messages from the same chat_id in order (FIFO)', async () => {
    const { app } = buildApp();

    const messages = ['Cafe 850', 'Taxi 1200', 'Super 4500'];
    const responses = await Promise.all(
      messages.map((text) =>
        app.inject({
          method: 'POST',
          url: '/webhook/telegram',
          headers: {
            'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
          },
          payload: makeValidPayload({ text }),
        }),
      ),
    );

    responses.forEach((response) => {
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ ok: true });
    });

    expect(mockQueueAdd).toHaveBeenCalledTimes(3);
    expect(mockSendAckExecute).toHaveBeenCalledTimes(3);
    messages.forEach((text, index) => {
      const [, jobData] = mockQueueAdd.mock.calls[index] as [string, IncomingMessageJobData];
      expect(jobData.messageType).toBe('TEXT');
      expect(jobData.chatId).toBe('123456789');
      expect(jobData.text).toBe(text);
    });
  });

  it('triggers HandleStartCommand for /start without enqueueing', async () => {
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

    expect(mockResolveIdentityExecute).toHaveBeenCalledWith({
      channel: 'telegram',
      externalId: '123456789',
    });
    expect(mockHandleStartExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      chatId: '123456789',
      username: 'Juan',
    });

    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockSendAckExecute).not.toHaveBeenCalled();
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

    expect(mockResolveIdentityExecute).toHaveBeenCalledWith({
      channel: 'telegram',
      externalId: '123456789',
    });
    expect(mockHandleStartExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      chatId: '123456789',
      username: undefined,
    });

    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockSendAckExecute).not.toHaveBeenCalled();
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

    expect(mockResolveIdentityExecute).toHaveBeenCalledWith({
      channel: 'telegram',
      externalId: '123456789',
    });
    expect(mockHandleStartExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      chatId: '123456789',
      username: undefined,
    });

    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockSendAckExecute).not.toHaveBeenCalled();
  });

  it('logs structured error when immediate acknowledgment fails', async () => {
    mockSendAckExecute.mockResolvedValue({ status: 'failure', errorCode: 'SEND_FAILED' });
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
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockSendAckExecute).toHaveBeenCalledTimes(1);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockLogError).toHaveBeenCalledWith({
      endpoint: '/webhook/telegram',
      code: 'ACK_SEND_FAILED',
      chatId: '123456789',
      errorCode: 'SEND_FAILED',
    });
  });
});

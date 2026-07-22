// LAYER: Interfaces / Integration Tests
// End-to-end tests for the Telegram webhook route and the thin
// incoming-message worker (ADR-011). They exercise the full path from
// the HTTP request to the outbound message or the process-message job.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Queue, Job } from 'bullmq';
import { registerTelegramWebhook, type TelegramWebhookDeps } from './telegram.webhook';
import { processIncomingMessageJob } from '../../workers/incomingMessage.worker';
import { RouteIncomingMessage } from '../../../application/use-cases/conversation/RouteIncomingMessage';
import { SendImmediateAcknowledgement } from '../../../application/use-cases/conversation/SendImmediateAcknowledgement';
import { ClassifyFreeTextExpenseIntent } from '../../../application/use-cases/conversation/ClassifyFreeTextExpenseIntent';
import { SendExpenseGuidance } from '../../../application/use-cases/conversation/SendExpenseGuidance';
import { HandleUnsupportedMessage } from '../../../application/use-cases/conversation/HandleUnsupportedMessage';
import type { GetConversationState } from '../../../application/use-cases/conversation/GetConversationState';
import type { ResolveUserIdentityUseCase } from '../../../application/use-cases/user/ResolveUserIdentity';
import type { HandleStartCommand } from '../../../application/use-cases/conversation/HandleStartCommand';
import type { IncomingMessageJobData } from '../../../application/ports/IncomingMessageJob';
import type { ProcessMessageJobData } from '../../../application/ports/ProcessMessageJob';
import type { MessagingOutputPort } from '../../../application/ports/output/messaging.port';

const WEBHOOK_SECRET = 'test-secret-token';

const mockSendMessage = vi.fn();
const mockResolveIdentity = vi.fn();
const mockHandleStartExecute = vi.fn();
const mockProcessQueueAdd = vi.fn();
const mockGetConversationStateExecute = vi.fn();
const mockProcessedExists = vi.fn();
const mockProcessedMarkAsProcessed = vi.fn();

function buildMessagingPort(): MessagingOutputPort {
  return { sendMessage: mockSendMessage };
}

function buildSendImmediateAcknowledgement(): SendImmediateAcknowledgement {
  return new SendImmediateAcknowledgement(buildMessagingPort());
}

function buildProcessedMessageRepository() {
  return {
    exists: mockProcessedExists,
    markAsProcessed: mockProcessedMarkAsProcessed,
  };
}

function buildRouteIncomingMessage(): RouteIncomingMessage {
  return new RouteIncomingMessage({
    messageQueue: { add: mockProcessQueueAdd } as unknown as Queue<ProcessMessageJobData>,
    resolveIdentity: { execute: mockResolveIdentity } as unknown as ResolveUserIdentityUseCase,
    handleUnsupportedMessage: new HandleUnsupportedMessage(buildMessagingPort()),
    classifyFreeTextExpenseIntent: new ClassifyFreeTextExpenseIntent(),
    sendGuidance: new SendExpenseGuidance(buildMessagingPort()),
    getConversationState: {
      execute: mockGetConversationStateExecute,
    } as unknown as GetConversationState,
    processedMessageRepository: buildProcessedMessageRepository(),
  });
}

function buildMockDeps(): TelegramWebhookDeps {
  return {
    webhookSecret: WEBHOOK_SECRET,
    incomingMessageQueue: {
      add: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue<IncomingMessageJobData>,
    handleStartCommand: {
      execute: mockHandleStartExecute,
    } as unknown as HandleStartCommand,
    sendImmediateAcknowledgement: buildSendImmediateAcknowledgement(),
    resolveIdentity: {
      execute: mockResolveIdentity,
    } as unknown as ResolveUserIdentityUseCase,
  };
}

function buildApp(deps: TelegramWebhookDeps = buildMockDeps()) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerTelegramWebhook(app, deps);
  return { app, deps };
}

function makeValidPayload(text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 42,
      from: { id: 999 },
      chat: { id: 123456789 },
      text,
      date: Math.floor(Date.now() / 1000),
    },
  };
}

async function processCapturedJob(
  capturedJobs: IncomingMessageJobData[],
  routeIncomingMessage: RouteIncomingMessage,
): Promise<void> {
  expect(capturedJobs).toHaveLength(1);
  const jobData = capturedJobs[0];
  await processIncomingMessageJob(
    { data: jobData } as Job<IncomingMessageJobData>,
    routeIncomingMessage,
  );
}

describe('POST /webhook/telegram — free-text expense routing (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue({ status: 'success' });
    mockResolveIdentity.mockResolvedValue({ userId: 'user-123' });
    mockHandleStartExecute.mockResolvedValue({ replyText: 'Welcome!' });
    mockProcessQueueAdd.mockResolvedValue(undefined);
    mockGetConversationStateExecute.mockResolvedValue({
      userId: 'user-123',
      currentState: 'IDLE',
      statePayload: null,
      enteredAt: new Date('2026-05-20T12:00:00Z'),
      expiresAt: null,
      updatedAt: new Date('2026-05-20T12:00:00Z'),
    });
    mockProcessedExists.mockResolvedValue(false);
    mockProcessedMarkAsProcessed.mockResolvedValue(undefined);
  });

  it('expense-like text: returns 200, enqueues process-message job, and sends ack', async () => {
    const capturedJobs: IncomingMessageJobData[] = [];
    const deps = buildMockDeps();
    (deps.incomingMessageQueue as unknown as { add: typeof mockProcessQueueAdd }).add = vi
      .fn()
      .mockImplementation((_name: string, data: IncomingMessageJobData) => {
        capturedJobs.push(data);
        return Promise.resolve(undefined);
      });

    const { app } = buildApp(deps);
    const routeIncomingMessage = buildRouteIncomingMessage();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      payload: makeValidPayload('Pagué el almuerzo, 12 euros'),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });
    expect(mockHandleStartExecute).not.toHaveBeenCalled();

    await vi.waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', 'Recibido, procesando tu mensaje…'),
    );

    await processCapturedJob(capturedJobs, routeIncomingMessage);

    expect(mockResolveIdentity).toHaveBeenCalledWith({
      channel: 'telegram',
      externalId: '123456789',
    });
    expect(mockProcessQueueAdd).toHaveBeenCalledTimes(1);
    const [, jobData] = mockProcessQueueAdd.mock.calls[0] as [string, ProcessMessageJobData];
    expect(jobData).toMatchObject({
      userId: 'user-123',
      rawMessage: 'Pagué el almuerzo, 12 euros',
      channel: 'telegram',
      externalId: '123456789',
      externalMessageId: '42',
    });
  });

  it('partial info text: returns 200 and enqueues process-message job', async () => {
    const capturedJobs: IncomingMessageJobData[] = [];
    const deps = buildMockDeps();
    (deps.incomingMessageQueue as unknown as { add: typeof mockProcessQueueAdd }).add = vi
      .fn()
      .mockImplementation((_name: string, data: IncomingMessageJobData) => {
        capturedJobs.push(data);
        return Promise.resolve(undefined);
      });

    const { app } = buildApp(deps);
    const routeIncomingMessage = buildRouteIncomingMessage();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      payload: makeValidPayload('Almuerzo 12'),
    });

    expect(response.statusCode).toBe(200);

    await vi.waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', 'Recibido, procesando tu mensaje…'),
    );

    await processCapturedJob(capturedJobs, routeIncomingMessage);

    expect(mockResolveIdentity).toHaveBeenCalledTimes(1);
    expect(mockProcessQueueAdd).toHaveBeenCalledTimes(1);
    const [, jobData] = mockProcessQueueAdd.mock.calls[0] as [string, ProcessMessageJobData];
    expect(jobData.rawMessage).toBe('Almuerzo 12');
  });

  it('non-financial text: returns 200, sends guidance, and does not enqueue', async () => {
    const capturedJobs: IncomingMessageJobData[] = [];
    const deps = buildMockDeps();
    (deps.incomingMessageQueue as unknown as { add: typeof mockProcessQueueAdd }).add = vi
      .fn()
      .mockImplementation((_name: string, data: IncomingMessageJobData) => {
        capturedJobs.push(data);
        return Promise.resolve(undefined);
      });

    const { app } = buildApp(deps);
    const routeIncomingMessage = buildRouteIncomingMessage();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      payload: makeValidPayload('Hola'),
    });

    expect(response.statusCode).toBe(200);

    await vi.waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', 'Recibido, procesando tu mensaje…'),
    );

    await processCapturedJob(capturedJobs, routeIncomingMessage);

    expect(mockResolveIdentity).toHaveBeenCalledTimes(1);
    expect(mockGetConversationStateExecute).toHaveBeenCalledWith({ userId: 'user-123' });
    expect(mockProcessQueueAdd).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456789',
      "¡Hola! Para registrar un gasto escribime el monto y el concepto, por ejemplo: 'Almuerzo 12 euros'.",
    );
  });

  it('non-financial reply during ONBOARDING_MAPPING: returns 200, enqueues process-message job, and sends ack', async () => {
    mockGetConversationStateExecute.mockResolvedValue({
      userId: 'user-123',
      currentState: 'ONBOARDING_MAPPING',
      statePayload: { mappings: [] },
      enteredAt: new Date('2026-05-20T12:00:00Z'),
      expiresAt: null,
      updatedAt: new Date('2026-05-20T12:00:00Z'),
    });

    const capturedJobs: IncomingMessageJobData[] = [];
    const deps = buildMockDeps();
    (deps.incomingMessageQueue as unknown as { add: typeof mockProcessQueueAdd }).add = vi
      .fn()
      .mockImplementation((_name: string, data: IncomingMessageJobData) => {
        capturedJobs.push(data);
        return Promise.resolve(undefined);
      });

    const { app } = buildApp(deps);
    const routeIncomingMessage = buildRouteIncomingMessage();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      payload: makeValidPayload('sí'),
    });

    expect(response.statusCode).toBe(200);

    await vi.waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', 'Recibido, procesando tu mensaje…'),
    );

    await processCapturedJob(capturedJobs, routeIncomingMessage);

    expect(mockResolveIdentity).toHaveBeenCalledTimes(1);
    expect(mockGetConversationStateExecute).toHaveBeenCalledWith({ userId: 'user-123' });
    expect(mockProcessQueueAdd).toHaveBeenCalledTimes(1);
    const [, jobData] = mockProcessQueueAdd.mock.calls[0] as [string, ProcessMessageJobData];
    expect(jobData.rawMessage).toBe('sí');
  });

  it('very long text: returns 200 and enqueues process-message job', async () => {
    const capturedJobs: IncomingMessageJobData[] = [];
    const deps = buildMockDeps();
    (deps.incomingMessageQueue as unknown as { add: typeof mockProcessQueueAdd }).add = vi
      .fn()
      .mockImplementation((_name: string, data: IncomingMessageJobData) => {
        capturedJobs.push(data);
        return Promise.resolve(undefined);
      });

    const { app } = buildApp(deps);
    const routeIncomingMessage = buildRouteIncomingMessage();
    const longText = 'a'.repeat(501);

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      payload: makeValidPayload(longText),
    });

    expect(response.statusCode).toBe(200);

    await vi.waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', 'Recibido, procesando tu mensaje…'),
    );

    await processCapturedJob(capturedJobs, routeIncomingMessage);

    expect(mockResolveIdentity).toHaveBeenCalledTimes(1);
    expect(mockProcessQueueAdd).toHaveBeenCalledTimes(1);
    const [, jobData] = mockProcessQueueAdd.mock.calls[0] as [string, ProcessMessageJobData];
    expect(jobData.rawMessage).toBe(longText);
  });

  it('duplicate payload: returns 200 and does not re-enqueue process-message job', async () => {
    mockProcessedExists.mockResolvedValue(true);
    const capturedJobs: IncomingMessageJobData[] = [];
    const deps = buildMockDeps();
    (deps.incomingMessageQueue as unknown as { add: typeof mockProcessQueueAdd }).add = vi
      .fn()
      .mockImplementation((_name: string, data: IncomingMessageJobData) => {
        capturedJobs.push(data);
        return Promise.resolve(undefined);
      });

    const { app } = buildApp(deps);
    const routeIncomingMessage = buildRouteIncomingMessage();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/telegram',
      headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      payload: makeValidPayload('Pagué el almuerzo, 12 euros'),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });

    await vi.waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', 'Recibido, procesando tu mensaje…'),
    );

    await processCapturedJob(capturedJobs, routeIncomingMessage);

    expect(mockProcessedExists).toHaveBeenCalledTimes(1);
    expect(mockResolveIdentity).not.toHaveBeenCalled();
    expect(mockProcessQueueAdd).not.toHaveBeenCalled();
    expect(mockProcessedMarkAsProcessed).not.toHaveBeenCalled();
  });
});

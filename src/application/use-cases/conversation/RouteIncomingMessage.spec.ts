// LAYER: Application / Tests
// Unit tests for RouteIncomingMessage use case.
// Covers TEXT routing (identity resolution, enqueue),
// classification-based routing, UNSUPPORTED delegation, and MALFORMED logging.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouteIncomingMessage } from './RouteIncomingMessage';
import type { NormalizedPayload } from '../../../domain/ports/messaging';
import type { ProcessMessageJobData } from '../../ports/ProcessMessageJob';
import type { RouteIncomingMessageDeps } from './RouteIncomingMessage';

const mockAdd = vi.fn();
const mockResolveExecute = vi.fn();
const mockUnsupportedExecute = vi.fn();
const mockClassifyExecute = vi.fn();
const mockSendGuidanceExecute = vi.fn();
const mockGetConversationStateExecute = vi.fn();
const mockProcessedExists = vi.fn();
const mockProcessedMarkAsProcessed = vi.fn();

function buildMockDeps() {
  return {
    messageQueue: { add: mockAdd },
    resolveIdentity: { execute: mockResolveExecute },
    handleUnsupportedMessage: {
      execute: mockUnsupportedExecute,
    },
    classifyFreeTextExpenseIntent: {
      execute: mockClassifyExecute,
    },
    sendGuidance: {
      execute: mockSendGuidanceExecute,
    },
    getConversationState: { execute: mockGetConversationStateExecute },
    processedMessageRepository: {
      exists: mockProcessedExists,
      markAsProcessed: mockProcessedMarkAsProcessed,
    },
  };
}

function buildTextPayload(overrides: Partial<NormalizedPayload> = {}): NormalizedPayload {
  return {
    messageType: 'TEXT',
    chatId: '123456789',
    userId: '999',
    text: 'Cafe con leche 850',
    timestamp: new Date('2026-05-20T12:00:00Z'),
    channel: 'telegram',
    externalMessageId: 'msg-42',
    ...overrides,
  };
}

describe('RouteIncomingMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdd.mockResolvedValue(undefined);
    mockResolveExecute.mockResolvedValue({ userId: 'user-123' });
    mockUnsupportedExecute.mockResolvedValue(undefined);
    mockSendGuidanceExecute.mockResolvedValue(undefined);
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

  describe('TEXT messages', () => {
    it('classifies expense-like text, resolves identity, and enqueues job', async () => {
      mockClassifyExecute.mockReturnValue({ kind: 'expense-like' });
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const payload = buildTextPayload();

      await router.execute(payload);

      expect(mockProcessedExists).toHaveBeenCalledTimes(1);
      expect(mockProcessedMarkAsProcessed).toHaveBeenCalledTimes(1);
      expect(mockClassifyExecute).toHaveBeenCalledWith('Cafe con leche 850');
      expect(mockResolveExecute).toHaveBeenCalledWith({
        channel: 'telegram',
        externalId: '123456789',
      });

      expect(mockAdd).toHaveBeenCalledTimes(1);
      const [, jobData] = mockAdd.mock.calls[0] as [string, ProcessMessageJobData];
      expect(jobData).toMatchObject({
        userId: 'user-123',
        rawMessage: 'Cafe con leche 850',
        channel: 'telegram',
        externalId: '123456789',
        externalMessageId: 'msg-42',
      });
      expect(new Date(jobData.receivedAt).getTime()).toBeGreaterThan(0);
    });

    it('skips already processed messages to avoid duplicate expense records', async () => {
      mockProcessedExists.mockResolvedValue(true);
      mockClassifyExecute.mockReturnValue({ kind: 'expense-like' });
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const payload = buildTextPayload();

      await router.execute(payload);

      expect(mockProcessedExists).toHaveBeenCalledTimes(1);
      expect(mockResolveExecute).not.toHaveBeenCalled();
      expect(mockClassifyExecute).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
      expect(mockProcessedMarkAsProcessed).not.toHaveBeenCalled();
    });

    it('classifies too-long text, resolves identity, and enqueues job', async () => {
      mockClassifyExecute.mockReturnValue({ kind: 'too-long' });
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const payload = buildTextPayload({ text: 'a'.repeat(501) });

      await router.execute(payload);

      expect(mockClassifyExecute).toHaveBeenCalledWith('a'.repeat(501));
      expect(mockResolveExecute).toHaveBeenCalledWith({
        channel: 'telegram',
        externalId: '123456789',
      });
      expect(mockAdd).toHaveBeenCalledTimes(1);
    });

    it('sends guidance for non-financial text when user is IDLE and does not enqueue', async () => {
      mockClassifyExecute.mockReturnValue({ kind: 'non-financial' });
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const payload = buildTextPayload({ text: 'Hola' });

      await router.execute(payload);

      expect(mockResolveExecute).toHaveBeenCalledWith({
        channel: 'telegram',
        externalId: '123456789',
      });
      expect(mockGetConversationStateExecute).toHaveBeenCalledWith({ userId: 'user-123' });
      expect(mockClassifyExecute).toHaveBeenCalledWith('Hola');
      expect(mockSendGuidanceExecute).toHaveBeenCalledTimes(1);
      expect(mockSendGuidanceExecute).toHaveBeenCalledWith('123456789');
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('enqueues non-financial text when user is in ONBOARDING_MAPPING', async () => {
      mockClassifyExecute.mockReturnValue({ kind: 'non-financial' });
      mockGetConversationStateExecute.mockResolvedValue({
        userId: 'user-123',
        currentState: 'ONBOARDING_MAPPING',
        statePayload: { mappings: [] },
        enteredAt: new Date('2026-05-20T12:00:00Z'),
        expiresAt: null,
        updatedAt: new Date('2026-05-20T12:00:00Z'),
      });
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const payload = buildTextPayload({ text: 'sí' });

      await router.execute(payload);

      expect(mockResolveExecute).toHaveBeenCalledWith({
        channel: 'telegram',
        externalId: '123456789',
      });
      expect(mockGetConversationStateExecute).toHaveBeenCalledWith({ userId: 'user-123' });
      expect(mockClassifyExecute).not.toHaveBeenCalled();
      expect(mockSendGuidanceExecute).not.toHaveBeenCalled();
      expect(mockAdd).toHaveBeenCalledTimes(1);
      const [, jobData] = mockAdd.mock.calls[0] as [string, ProcessMessageJobData];
      expect(jobData).toMatchObject({
        userId: 'user-123',
        rawMessage: 'sí',
        channel: 'telegram',
        externalId: '123456789',
        externalMessageId: 'msg-42',
      });
    });

    it('enqueues non-financial text when user is in EXPENSE_REVIEW', async () => {
      mockClassifyExecute.mockReturnValue({ kind: 'non-financial' });
      mockGetConversationStateExecute.mockResolvedValue({
        userId: 'user-123',
        currentState: 'EXPENSE_REVIEW',
        statePayload: { extracted: { monto: 100 } },
        enteredAt: new Date('2026-05-20T12:00:00Z'),
        expiresAt: null,
        updatedAt: new Date('2026-05-20T12:00:00Z'),
      });
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const payload = buildTextPayload({ text: 'corregir categoría' });

      await router.execute(payload);

      expect(mockClassifyExecute).not.toHaveBeenCalled();
      expect(mockSendGuidanceExecute).not.toHaveBeenCalled();
      expect(mockAdd).toHaveBeenCalledTimes(1);
      const [, jobData] = mockAdd.mock.calls[0] as [string, ProcessMessageJobData];
      expect(jobData.rawMessage).toBe('corregir categoría');
      expect(jobData.externalMessageId).toBe('msg-42');
    });

    it('treats a missing conversation state as IDLE and sends guidance for non-financial text', async () => {
      mockClassifyExecute.mockReturnValue({ kind: 'non-financial' });
      mockGetConversationStateExecute.mockResolvedValue(null);
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const payload = buildTextPayload({ text: 'Hola' });

      await router.execute(payload);

      expect(mockClassifyExecute).toHaveBeenCalledWith('Hola');
      expect(mockSendGuidanceExecute).toHaveBeenCalledTimes(1);
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('rethrows when enqueue fails', async () => {
      mockClassifyExecute.mockReturnValue({ kind: 'expense-like' });
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      mockAdd.mockRejectedValue(new Error('Queue full'));

      await expect(router.execute(buildTextPayload())).rejects.toThrow('Queue full');
    });

    it('delegates to unsupported handler when TEXT payload has no text', async () => {
      mockClassifyExecute.mockReturnValue({ kind: 'non-financial' });
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const payload = buildTextPayload({ text: undefined });

      await router.execute(payload);

      expect(mockUnsupportedExecute).toHaveBeenCalledWith('123456789');
      expect(mockClassifyExecute).not.toHaveBeenCalled();
      expect(mockResolveExecute).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
      expect(mockSendGuidanceExecute).not.toHaveBeenCalled();
    });
  });

  describe('UNSUPPORTED messages', () => {
    it('delegates to HandleUnsupportedMessage', async () => {
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const payload: NormalizedPayload = {
        messageType: 'UNSUPPORTED',
        chatId: '123456789',
        userId: '999',
        timestamp: new Date('2026-05-20T12:00:00Z'),
        channel: 'telegram',
      };

      await router.execute(payload);

      expect(mockUnsupportedExecute).toHaveBeenCalledTimes(1);
      expect(mockUnsupportedExecute).toHaveBeenCalledWith('123456789');
      expect(mockResolveExecute).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
      expect(mockClassifyExecute).not.toHaveBeenCalled();
    });
  });
});

// LAYER: Application / Tests
// Unit tests for RouteIncomingMessage use case.
// Covers TEXT routing (identity resolution, enqueue, ack),
// UNSUPPORTED delegation, and MALFORMED logging.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouteIncomingMessage } from './RouteIncomingMessage';
import type { NormalizedPayload } from '../../../domain/ports/messaging';
import type { ProcessMessageJobData } from '../../ports/ProcessMessageJob';
import type { RouteIncomingMessageDeps } from './RouteIncomingMessage';

const mockSendMessage = vi.fn();
const mockAdd = vi.fn();
const mockResolveExecute = vi.fn();
const mockUnsupportedExecute = vi.fn();

function buildMockDeps() {
  return {
    messageQueue: { add: mockAdd },
    resolveIdentity: { execute: mockResolveExecute },
    messagingPort: { sendMessage: mockSendMessage },
    handleUnsupportedMessage: {
      execute: mockUnsupportedExecute,
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
    ...overrides,
  };
}

describe('RouteIncomingMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
    mockAdd.mockResolvedValue(undefined);
    mockResolveExecute.mockResolvedValue({ userId: 'user-123' });
    mockUnsupportedExecute.mockResolvedValue(undefined);
  });

  describe('TEXT messages', () => {
    it('resolves identity, enqueues job, and sends ack', async () => {
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const payload = buildTextPayload();

      await router.execute(payload);

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
      });
      expect(new Date(jobData.receivedAt).getTime()).toBeGreaterThan(0);

      expect(mockSendMessage).toHaveBeenCalledWith('123456789', 'Recibido, procesando tu gasto…');
    });

    it('does not send ack if enqueue fails', async () => {
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      mockAdd.mockRejectedValue(new Error('Queue full'));

      await expect(router.execute(buildTextPayload())).rejects.toThrow('Queue full');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('delegates to unsupported handler when TEXT payload has no text', async () => {
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const payload = buildTextPayload({ text: undefined });

      await router.execute(payload);

      expect(mockUnsupportedExecute).toHaveBeenCalledWith('123456789');
      expect(mockResolveExecute).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
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
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('MALFORMED payloads', () => {
    it('logs structured error without enqueueing or messaging', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      const raw = { unexpected: 'data' };
      const payload: NormalizedPayload = {
        messageType: 'MALFORMED',
        chatId: 'unknown',
        timestamp: new Date('2026-05-20T12:00:00Z'),
        channel: 'telegram',
        rawPayload: raw,
      };

      await router.execute(payload);

      expect(consoleError).toHaveBeenCalledWith({
        endpoint: '/webhook/telegram',
        code: 'MALFORMED_PAYLOAD',
        rawPayload: raw,
      });
      expect(mockResolveExecute).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();

      consoleError.mockRestore();
    });
  });
});

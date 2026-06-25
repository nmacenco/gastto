// LAYER: Application / Tests
// Unit tests for RouteIncomingMessage use case.
// Covers TEXT routing (identity resolution, enqueue, ack),
// UNSUPPORTED delegation, and MALFORMED logging.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { RouteIncomingMessage } from './RouteIncomingMessage';
import type { NormalizedPayload } from '../../../domain/ports/messaging';
import type { ProcessMessageJobData } from '../../ports/ProcessMessageJob';
import type { RouteIncomingMessageDeps } from './RouteIncomingMessage';

const mockSendMessage = vi.fn();
const mockAdd = vi.fn();
const mockResolveExecute = vi.fn();
const mockUnsupportedExecute = vi.fn();
const mockLoggerError = vi.fn();

function buildMockDeps() {
  return {
    messageQueue: { add: mockAdd },
    resolveIdentity: { execute: mockResolveExecute },
    messagingPort: { sendMessage: mockSendMessage },
    handleUnsupportedMessage: {
      execute: mockUnsupportedExecute,
    },
    logger: { error: mockLoggerError } as unknown as Logger,
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
    mockSendMessage.mockResolvedValue({ status: 'success' });
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

    it('logs structured error but does not throw when ack send fails', async () => {
      const deps = buildMockDeps();
      const router = new RouteIncomingMessage(deps as unknown as RouteIncomingMessageDeps);
      mockSendMessage.mockRejectedValue(new Error('Network timeout'));

      await router.execute(buildTextPayload());

      expect(mockAdd).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).toHaveBeenCalledWith({
        endpoint: '/webhook/telegram',
        code: 'ACK_SEND_FAILED',
        chatId: '123456789',
        error: 'Network timeout',
      });
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
});

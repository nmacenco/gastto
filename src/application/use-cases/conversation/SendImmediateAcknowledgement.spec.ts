// LAYER: Application / Tests
// Unit tests for SendImmediateAcknowledgement use case.
// Covers success, port-level failure, and unexpected exceptions.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SendImmediateAcknowledgement } from './SendImmediateAcknowledgement';
import type { MessagingOutputPort, SendResult } from '../../ports/output/messaging.port';

const mockSendMessage = vi.fn();

function buildMockPort(): MessagingOutputPort {
  return { sendMessage: mockSendMessage };
}

const baseInput = { chatId: '123456789', channel: 'telegram' as const };

describe('SendImmediateAcknowledgement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue({ status: 'success' } satisfies SendResult);
  });

  it('sends the processing acknowledgment and returns the success result', async () => {
    const messagingPort = buildMockPort();
    const useCase = new SendImmediateAcknowledgement(messagingPort);

    const result = await useCase.execute(baseInput);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456789',
      'Recibido, procesando tu mensaje…',
    );
    expect(result).toEqual({ status: 'success' });
  });

  it('returns the failure result from the port without throwing', async () => {
    const failure: SendResult = { status: 'failure', errorCode: 'SEND_FAILED' };
    mockSendMessage.mockResolvedValue(failure);
    const messagingPort = buildMockPort();
    const useCase = new SendImmediateAcknowledgement(messagingPort);

    const result = await useCase.execute(baseInput);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(result).toEqual(failure);
  });

  it('surfaces a rejected sendMessage as a SendResultFailure', async () => {
    mockSendMessage.mockRejectedValue(new Error('Network timeout'));
    const messagingPort = buildMockPort();
    const useCase = new SendImmediateAcknowledgement(messagingPort);

    const result = await useCase.execute(baseInput);

    expect(result).toEqual({ status: 'failure', errorCode: 'SEND_FAILED' });
  });

  it('accepts an optional userId', async () => {
    const messagingPort = buildMockPort();
    const useCase = new SendImmediateAcknowledgement(messagingPort);

    await useCase.execute({ ...baseInput, userId: 'user-123' });

    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456789',
      'Recibido, procesando tu mensaje…',
    );
  });

  it('accepts whatsapp as channel', async () => {
    const messagingPort = buildMockPort();
    const useCase = new SendImmediateAcknowledgement(messagingPort);

    await useCase.execute({ ...baseInput, channel: 'whatsapp' });

    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456789',
      'Recibido, procesando tu mensaje…',
    );
  });
});

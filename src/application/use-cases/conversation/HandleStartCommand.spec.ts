// LAYER: Application / Tests
// Unit tests for HandleStartCommand.
// Pure domain/application logic — no Fastify, no Telegram, no HTTP.

import { describe, it, expect, vi } from 'vitest';
import { HandleStartCommand, type HandleStartCommandInput } from './HandleStartCommand';
import type { IChatMessenger } from '../../ports/IChatMessenger';

function buildMockMessenger(): {
  messenger: IChatMessenger;
  sendWelcomeMock: ReturnType<typeof vi.fn>;
} {
  const sendWelcomeMock = vi.fn().mockResolvedValue(undefined);
  const messenger: IChatMessenger = {
    sendWelcome: sendWelcomeMock,
  };
  return { messenger, sendWelcomeMock };
}

describe('HandleStartCommand', () => {
  it('returns a welcome message with the username when provided', async () => {
    const { messenger, sendWelcomeMock } = buildMockMessenger();
    const useCase = new HandleStartCommand(messenger);

    const input: HandleStartCommandInput = { chatId: '123456789', username: 'Juan' };
    const output = await useCase.execute(input);

    expect(output.replyText).toContain('¡Hola, Juan!');
    expect(sendWelcomeMock).toHaveBeenCalledWith('123456789', 'Juan');
  });

  it('returns a generic welcome message when no username is provided', async () => {
    const { messenger, sendWelcomeMock } = buildMockMessenger();
    const useCase = new HandleStartCommand(messenger);

    const input: HandleStartCommandInput = { chatId: '987654321' };
    const output = await useCase.execute(input);

    expect(output.replyText).toContain('¡Hola!');
    expect(output.replyText).not.toContain('undefined');
    expect(sendWelcomeMock).toHaveBeenCalledWith('987654321', undefined);
  });

  it('does not throw when messenger resolves successfully', async () => {
    const { messenger } = buildMockMessenger();
    const useCase = new HandleStartCommand(messenger);

    await expect(useCase.execute({ chatId: '111' })).resolves.toBeDefined();
  });

  it('propagates errors from the messenger adapter', async () => {
    const { messenger, sendWelcomeMock } = buildMockMessenger();
    sendWelcomeMock.mockRejectedValue(new Error('network failure'));

    const useCase = new HandleStartCommand(messenger);

    await expect(useCase.execute({ chatId: '222' })).rejects.toThrow('network failure');
  });
});

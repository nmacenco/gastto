// LAYER: Application / Tests
// Unit tests for HandleStartCommand.
// Pure domain/application logic — no Fastify, no Telegram, no HTTP.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandleStartCommand, type HandleStartCommandInput } from './HandleStartCommand';
import type { IChatMessenger } from '../../ports/IChatMessenger';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import { sharedCopies } from '../../copies/shared.copies';

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

const mockFindByUserId = vi.fn();
const mockCreate = vi.fn();

function buildMockConversationRepo(
  overrides: Partial<IConversationStateRepository> = {},
): IConversationStateRepository {
  return {
    findByUserId: mockFindByUserId,
    create: mockCreate,
    transition: vi.fn(),
    findExpired: vi.fn(),
    ...overrides,
  };
}

describe('HandleStartCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a welcome message with the username when provided', async () => {
    const { messenger, sendWelcomeMock } = buildMockMessenger();
    const repo = buildMockConversationRepo();
    mockFindByUserId.mockResolvedValue({ userId: 'user-1', currentState: 'IDLE' });

    const useCase = new HandleStartCommand(messenger, repo);

    const input: HandleStartCommandInput = {
      userId: 'user-1',
      chatId: '123456789',
      username: 'Juan',
    };
    const output = await useCase.execute(input);

    expect(output.replyText).toBe(sharedCopies.welcome('Juan'));
    expect(sendWelcomeMock).toHaveBeenCalledWith('123456789', 'Juan');
    expect(mockFindByUserId).toHaveBeenCalledWith('user-1');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns a generic welcome message when no username is provided', async () => {
    const { messenger, sendWelcomeMock } = buildMockMessenger();
    const repo = buildMockConversationRepo();
    mockFindByUserId.mockResolvedValue({ userId: 'user-2', currentState: 'IDLE' });

    const useCase = new HandleStartCommand(messenger, repo);

    const input: HandleStartCommandInput = { userId: 'user-2', chatId: '987654321' };
    const output = await useCase.execute(input);

    expect(output.replyText).toBe(sharedCopies.welcome());
    expect(output.replyText).not.toContain('undefined');
    expect(sendWelcomeMock).toHaveBeenCalledWith('987654321', undefined);
    expect(mockFindByUserId).toHaveBeenCalledWith('user-2');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates conversation state when user does not have one', async () => {
    const { messenger, sendWelcomeMock } = buildMockMessenger();
    const repo = buildMockConversationRepo();
    mockFindByUserId.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ userId: 'user-3', currentState: 'IDLE' });

    const useCase = new HandleStartCommand(messenger, repo);

    await expect(useCase.execute({ userId: 'user-3', chatId: '111' })).resolves.toBeDefined();

    expect(sendWelcomeMock).toHaveBeenCalledWith('111', undefined);
    expect(mockFindByUserId).toHaveBeenCalledWith('user-3');
    expect(mockCreate).toHaveBeenCalledWith('user-3');
  });

  it('does not throw when messenger resolves successfully', async () => {
    const { messenger } = buildMockMessenger();
    const repo = buildMockConversationRepo();
    mockFindByUserId.mockResolvedValue({ userId: 'user-4', currentState: 'IDLE' });

    const useCase = new HandleStartCommand(messenger, repo);

    await expect(useCase.execute({ userId: 'user-4', chatId: '111' })).resolves.toBeDefined();
  });

  it('propagates errors from the messenger adapter', async () => {
    const { messenger, sendWelcomeMock } = buildMockMessenger();
    const repo = buildMockConversationRepo();
    sendWelcomeMock.mockRejectedValue(new Error('network failure'));

    const useCase = new HandleStartCommand(messenger, repo);

    await expect(useCase.execute({ userId: 'user-5', chatId: '222' })).rejects.toThrow(
      'network failure',
    );
  });
});

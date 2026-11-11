// LAYER: Application / Tests
// Unit tests for HandleStartCommand.
// Pure domain/application logic — no Fastify, no Telegram, no HTTP.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandleStartCommand, type HandleStartCommandInput } from './HandleStartCommand';
import type { IChatMessenger } from '../../ports/IChatMessenger';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import { sharedCopies } from '../../copies/shared.copies';
import { accessCopies } from '../../copies/access.copies';
import type { AccessRequestRepository } from '../../../domain/ports/AccessRequestRepository';
import type { TransitionConversationState } from './TransitionConversationState';

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

  it('shows the access welcome only on the first /start', async () => {
    const { messenger } = buildMockMessenger();
    const repo = buildMockConversationRepo();
    const initial = {
      userId: 'user-1',
      revision: '0',
      currentState: 'ONBOARDING_START' as const,
      statePayload: { promptShown: false },
      expiresAt: null,
    };
    mockFindByUserId.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      ...initial,
      revision: '1',
      statePayload: { promptShown: false, accessWelcomeShown: true },
    });
    const transitionExecute = vi.fn().mockResolvedValue({ status: 'updated' });
    const transition = {
      execute: transitionExecute,
      precondition: vi.fn().mockReturnValue({ revision: '0', currentState: 'ONBOARDING_START' }),
    } as unknown as TransitionConversationState;
    const sendMessage = vi.fn().mockResolvedValue({ status: 'success' });
    const useCase = new HandleStartCommand(
      messenger,
      repo,
      transition,
      undefined,
      undefined,
      {
        findApproved: vi.fn().mockResolvedValue(null),
        findPending: vi.fn().mockResolvedValue(null),
      } as unknown as AccessRequestRepository,
      { sendMessage },
    );

    await useCase.execute({ userId: 'user-1', chatId: '123' });
    await useCase.execute({ userId: 'user-1', chatId: '123' });

    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      '123',
      [accessCopies.welcome(), accessCopies.askEmail()].join('\n\n'),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(2, '123', accessCopies.askEmail());
    expect(transitionExecute).toHaveBeenCalledTimes(1);
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

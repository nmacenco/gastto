// LAYER: Application / Tests
// Unit tests for HandleExpiredSessions use case.
// Mocks repository, transition use case, and messaging port.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandleExpiredSessions } from './HandleExpiredSessions';
import { type TransitionConversationState } from './TransitionConversationState';
import type {
  IConversationStateRepository,
  IUserRepository,
} from '../../../domain/ports/repositories';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { Logger } from 'pino';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { MessagingIdentity } from '../../../domain/entities/User';

const mockFindExpired = vi.fn();
const mockTransitionExecute = vi.fn();
const mockFindMessagingIdentities = vi.fn();
const mockSendMessage = vi.fn();
const mockLoggerError = vi.fn();
const mockLogger = { error: mockLoggerError } as unknown as Logger;

function buildMockConversationRepo(
  overrides: Partial<IConversationStateRepository> = {},
): IConversationStateRepository {
  return {
    findByUserId: vi.fn(),
    create: vi.fn(),
    transition: vi.fn(),
    findExpired: mockFindExpired,
    ...overrides,
  };
}

function buildMockUserRepo(overrides: Partial<IUserRepository> = {}): IUserRepository {
  return {
    findById: vi.fn(),
    findByMessagingIdentity: vi.fn(),
    createWithIdentity: vi.fn(),
    updateStatus: vi.fn(),
    updateDefaultCurrency: vi.fn(),
    findMessagingIdentitiesByUserId: mockFindMessagingIdentities,
    ...overrides,
  };
}

function buildMockTransitionState(): TransitionConversationState {
  return { execute: mockTransitionExecute } as unknown as TransitionConversationState;
}

function buildMockMessagingPort(): MessagingOutputPort {
  return { sendMessage: mockSendMessage };
}

function buildConversationState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    userId: 'user-123',
    currentState: 'EXPENSE_REVIEW',
    statePayload: null,
    enteredAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildMessagingIdentity(overrides: Partial<MessagingIdentity> = {}): MessagingIdentity {
  return {
    id: 'identity-1',
    userId: 'user-123',
    channel: 'telegram',
    externalId: '123456789',
    linkedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('HandleExpiredSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransitionExecute.mockResolvedValue(buildConversationState({ currentState: 'IDLE' }));
    mockSendMessage.mockResolvedValue({ status: 'success' });
  });

  it('transitions expired states to IDLE and sends timeout message to each identity', async () => {
    const conversationRepo = buildMockConversationRepo();
    const userRepo = buildMockUserRepo();
    const transitionState = buildMockTransitionState();
    const messagingPort = buildMockMessagingPort();

    mockFindExpired.mockResolvedValue([
      buildConversationState({ userId: 'user-1', currentState: 'EXPENSE_REVIEW' }),
      buildConversationState({ userId: 'user-2', currentState: 'EXPENSE_CLARIFYING' }),
    ]);

    mockFindMessagingIdentities
      .mockResolvedValueOnce([buildMessagingIdentity({ userId: 'user-1' })])
      .mockResolvedValueOnce([
        buildMessagingIdentity({ userId: 'user-2', externalId: '987654321' }),
      ]);

    const useCase = new HandleExpiredSessions(
      conversationRepo,
      userRepo,
      transitionState,
      messagingPort,
      mockLogger,
    );
    await useCase.execute();

    expect(mockFindExpired).toHaveBeenCalledTimes(1);
    expect(mockTransitionExecute).toHaveBeenCalledTimes(2);
    expect(mockTransitionExecute).toHaveBeenNthCalledWith(1, {
      userId: 'user-1',
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
    });
    expect(mockTransitionExecute).toHaveBeenNthCalledWith(2, {
      userId: 'user-2',
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
    });

    expect(mockFindMessagingIdentities).toHaveBeenCalledWith('user-1');
    expect(mockFindMessagingIdentities).toHaveBeenCalledWith('user-2');

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456789',
      'Tu sesion expiro. Queres continuar o empezar de nuevo?',
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      'Tu sesion expiro. Queres continuar o empezar de nuevo?',
    );
  });

  it('does nothing when no expired states exist', async () => {
    const conversationRepo = buildMockConversationRepo();
    const userRepo = buildMockUserRepo();
    const transitionState = buildMockTransitionState();
    const messagingPort = buildMockMessagingPort();

    mockFindExpired.mockResolvedValue([]);

    const useCase = new HandleExpiredSessions(
      conversationRepo,
      userRepo,
      transitionState,
      messagingPort,
      mockLogger,
    );
    await useCase.execute();

    expect(mockTransitionExecute).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('continues processing remaining users when one transition fails', async () => {
    const conversationRepo = buildMockConversationRepo();
    const userRepo = buildMockUserRepo();
    const transitionState = buildMockTransitionState();
    const messagingPort = buildMockMessagingPort();

    mockFindExpired.mockResolvedValue([
      buildConversationState({ userId: 'user-1' }),
      buildConversationState({ userId: 'user-2' }),
    ]);

    mockTransitionExecute
      .mockRejectedValueOnce(new Error('Transition failed'))
      .mockResolvedValueOnce(buildConversationState({ userId: 'user-2', currentState: 'IDLE' }));

    mockFindMessagingIdentities.mockResolvedValue([
      buildMessagingIdentity({ userId: 'user-2', externalId: '987654321' }),
    ]);

    const useCase = new HandleExpiredSessions(
      conversationRepo,
      userRepo,
      transitionState,
      messagingPort,
      mockLogger,
    );
    await useCase.execute();

    expect(mockTransitionExecute).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      'Tu sesion expiro. Queres continuar o empezar de nuevo?',
    );

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Failed to process expired session',
        userId: 'user-1',
        error: 'Transition failed',
      }),
    );
  });

  it('continues sending to remaining identities when one send fails', async () => {
    const conversationRepo = buildMockConversationRepo();
    const userRepo = buildMockUserRepo();
    const transitionState = buildMockTransitionState();
    const messagingPort = buildMockMessagingPort();

    mockFindExpired.mockResolvedValue([buildConversationState({ userId: 'user-1' })]);
    mockFindMessagingIdentities.mockResolvedValue([
      buildMessagingIdentity({ userId: 'user-1', externalId: '111' }),
      buildMessagingIdentity({ userId: 'user-1', externalId: '222', channel: 'whatsapp' }),
    ]);

    mockSendMessage
      .mockRejectedValueOnce(new Error('Send failed'))
      .mockResolvedValueOnce({ status: 'success' });

    const useCase = new HandleExpiredSessions(
      conversationRepo,
      userRepo,
      transitionState,
      messagingPort,
      mockLogger,
    );
    await useCase.execute();

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenNthCalledWith(
      1,
      '111',
      'Tu sesion expiro. Queres continuar o empezar de nuevo?',
    );
    expect(mockSendMessage).toHaveBeenNthCalledWith(
      2,
      '222',
      'Tu sesion expiro. Queres continuar o empezar de nuevo?',
    );

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Failed to send session timeout message',
        userId: 'user-1',
        channel: 'telegram',
        externalId: '111',
        error: 'Send failed',
      }),
    );
  });
});

// LAYER: Application / Tests
// Unit tests for HandleExpiredSessions use case.
// Mocks repository, transition use case, messaging port, and presenter.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandleExpiredSessions } from './HandleExpiredSessions';
import { TransitionConversationState } from './TransitionConversationState';
import type {
  IConversationStateRepository,
  IUserRepository,
} from '../../../domain/ports/repositories';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { ExpenseSummaryPresenter } from '../../ports/output/expense-summary.presenter';
import type { Logger } from 'pino';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { MessagingIdentity } from '../../../domain/entities/User';

const mockFindExpired = vi.fn();
const mockTransitionExecute = vi.fn();
const mockFindMessagingIdentities = vi.fn();
const mockSendMessage = vi.fn();
const mockLoggerError = vi.fn();
const mockLogger = { error: mockLoggerError } as unknown as Logger;
const mockShowTimeoutWarning = vi.fn();
const mockNotifyCancellation = vi.fn();

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

function buildMockPresenterFactory(): (
  messaging: MessagingOutputPort,
  chatId: string,
) => ExpenseSummaryPresenter {
  return (_messaging, _chatId) => ({
    presentSummary: vi.fn(),
    showTimeoutWarning: mockShowTimeoutWarning,
    notifyCancellation: mockNotifyCancellation,
    requestHighAmountConfirmation: vi.fn(),
  });
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

function buildUseCase(
  conversationRepo: IConversationStateRepository,
  userRepo: IUserRepository,
  transitionState: TransitionConversationState,
  messagingPort: MessagingOutputPort,
) {
  return new HandleExpiredSessions(
    conversationRepo,
    userRepo,
    transitionState,
    messagingPort,
    buildMockPresenterFactory(),
    10,
    mockLogger,
  );
}

describe('HandleExpiredSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransitionExecute.mockResolvedValue(buildConversationState({ currentState: 'IDLE' }));
    mockSendMessage.mockResolvedValue({ status: 'success' });
    mockShowTimeoutWarning.mockResolvedValue(undefined);
    mockNotifyCancellation.mockResolvedValue(undefined);
  });

  it('sends a one-time reminder and extends the review state when reminderSent is false', async () => {
    const conversationRepo = buildMockConversationRepo();
    const userRepo = buildMockUserRepo();
    const transitionState = buildMockTransitionState();
    const messagingPort = buildMockMessagingPort();

    mockFindExpired.mockResolvedValue([
      buildConversationState({
        userId: 'user-1',
        currentState: 'EXPENSE_REVIEW',
        statePayload: { reminderSent: false },
      }),
    ]);
    mockFindMessagingIdentities.mockResolvedValue([buildMessagingIdentity({ userId: 'user-1' })]);

    const beforeExecute = Date.now();
    const useCase = buildUseCase(conversationRepo, userRepo, transitionState, messagingPort);
    await useCase.execute();

    expect(mockTransitionExecute).toHaveBeenCalledTimes(1);
    const transitionCall = mockTransitionExecute.mock.calls[0]![0] as {
      userId: string;
      targetState: string;
      payload: Record<string, unknown> | null;
      expiresAt: Date;
    };
    expect(transitionCall.userId).toBe('user-1');
    expect(transitionCall.targetState).toBe('EXPENSE_REVIEW');
    expect(transitionCall.payload).toEqual({ reminderSent: true });
    expect(transitionCall.expiresAt.getTime()).toBeGreaterThanOrEqual(
      beforeExecute + 10 * 60 * 1000,
    );

    expect(mockShowTimeoutWarning).toHaveBeenCalledTimes(1);
    expect(mockNotifyCancellation).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('cancels the review and notifies the user when reminderSent is true', async () => {
    const conversationRepo = buildMockConversationRepo();
    const userRepo = buildMockUserRepo();
    const transitionState = buildMockTransitionState();
    const messagingPort = buildMockMessagingPort();

    mockFindExpired.mockResolvedValue([
      buildConversationState({
        userId: 'user-1',
        currentState: 'EXPENSE_REVIEW',
        statePayload: { reminderSent: true },
      }),
    ]);
    mockFindMessagingIdentities.mockResolvedValue([buildMessagingIdentity({ userId: 'user-1' })]);

    const useCase = buildUseCase(conversationRepo, userRepo, transitionState, messagingPort);
    await useCase.execute();

    expect(mockTransitionExecute).toHaveBeenCalledTimes(1);
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-1',
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
    });

    expect(mockNotifyCancellation).toHaveBeenCalledTimes(1);
    expect(mockShowTimeoutWarning).not.toHaveBeenCalled();
  });

  it('expires an undo confirmation safely to IDLE and sends the generic timeout message', async () => {
    const conversationRepo = buildMockConversationRepo();
    const userRepo = buildMockUserRepo();
    const transitionState = buildMockTransitionState();
    const messagingPort = buildMockMessagingPort();

    mockFindExpired.mockResolvedValue([
      buildConversationState({ userId: 'user-1', currentState: 'EXPENSE_UNDO_CONFIRMING' }),
    ]);
    mockFindMessagingIdentities.mockResolvedValue([buildMessagingIdentity({ userId: 'user-1' })]);

    const useCase = buildUseCase(conversationRepo, userRepo, transitionState, messagingPort);
    await useCase.execute();

    expect(mockTransitionExecute).toHaveBeenCalledTimes(1);
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-1',
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456789',
      'Tu sesion expiro. Queres continuar o empezar de nuevo?',
    );
    expect(mockShowTimeoutWarning).not.toHaveBeenCalled();
    expect(mockNotifyCancellation).not.toHaveBeenCalled();
  });

  it('expires onboarding through the real transition validator and clears session data', async () => {
    let persistedState = buildConversationState({
      userId: 'user-1',
      currentState: 'ONBOARDING_MAPPING',
      statePayload: { mapping: { amount: 'B' } },
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    });
    const repositoryTransition = vi.fn(
      (
        userId: string,
        targetState: ConversationState['currentState'],
        statePayload: Record<string, unknown> | null,
        expiresAt: Date | null,
      ) => {
        persistedState = {
          ...persistedState,
          userId,
          currentState: targetState,
          statePayload,
          expiresAt,
        };
        return Promise.resolve(persistedState);
      },
    );
    const conversationRepo = buildMockConversationRepo({
      findByUserId: vi.fn(() => Promise.resolve(persistedState)),
      transition: repositoryTransition,
    });
    const userRepo = buildMockUserRepo();
    const messagingPort = buildMockMessagingPort();
    const transitionState = new TransitionConversationState(conversationRepo);

    mockFindExpired.mockResolvedValue([persistedState]);
    mockFindMessagingIdentities.mockResolvedValue([buildMessagingIdentity({ userId: 'user-1' })]);

    const useCase = buildUseCase(conversationRepo, userRepo, transitionState, messagingPort);
    await useCase.execute();

    expect(repositoryTransition).toHaveBeenCalledWith('user-1', 'IDLE', null, null);
    expect(persistedState).toEqual(
      expect.objectContaining({
        currentState: 'IDLE',
        statePayload: null,
        expiresAt: null,
      }),
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456789',
      'Tu sesion expiro. Queres continuar o empezar de nuevo?',
    );
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('does nothing when no expired states exist', async () => {
    const conversationRepo = buildMockConversationRepo();
    const userRepo = buildMockUserRepo();
    const transitionState = buildMockTransitionState();
    const messagingPort = buildMockMessagingPort();

    mockFindExpired.mockResolvedValue([]);

    const useCase = buildUseCase(conversationRepo, userRepo, transitionState, messagingPort);
    await useCase.execute();

    expect(mockTransitionExecute).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockShowTimeoutWarning).not.toHaveBeenCalled();
    expect(mockNotifyCancellation).not.toHaveBeenCalled();
  });

  it('continues processing remaining users when one transition fails', async () => {
    const conversationRepo = buildMockConversationRepo();
    const userRepo = buildMockUserRepo();
    const transitionState = buildMockTransitionState();
    const messagingPort = buildMockMessagingPort();

    mockFindExpired.mockResolvedValue([
      buildConversationState({ userId: 'user-1', currentState: 'EXPENSE_REVIEW' }),
      buildConversationState({ userId: 'user-2', currentState: 'EXPENSE_REVIEW' }),
    ]);

    mockTransitionExecute
      .mockRejectedValueOnce(new Error('Transition failed'))
      .mockResolvedValueOnce(buildConversationState({ userId: 'user-2', currentState: 'IDLE' }));

    mockFindMessagingIdentities.mockResolvedValue([
      buildMessagingIdentity({ userId: 'user-2', externalId: '987654321' }),
    ]);

    const useCase = buildUseCase(conversationRepo, userRepo, transitionState, messagingPort);
    await useCase.execute();

    expect(mockTransitionExecute).toHaveBeenCalledTimes(2);

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Failed to process expired session',
        userId: 'user-1',
        error: 'Transition failed',
      }),
    );
  });

  it('continues sending reminders to remaining identities when one send fails', async () => {
    const conversationRepo = buildMockConversationRepo();
    const userRepo = buildMockUserRepo();
    const transitionState = buildMockTransitionState();
    const messagingPort = buildMockMessagingPort();

    mockFindExpired.mockResolvedValue([
      buildConversationState({
        userId: 'user-1',
        currentState: 'EXPENSE_REVIEW',
        statePayload: { reminderSent: false },
      }),
    ]);
    mockFindMessagingIdentities.mockResolvedValue([
      buildMessagingIdentity({ userId: 'user-1', externalId: '111' }),
      buildMessagingIdentity({ userId: 'user-1', externalId: '222', channel: 'whatsapp' }),
    ]);

    mockShowTimeoutWarning
      .mockRejectedValueOnce(new Error('Send failed'))
      .mockResolvedValueOnce(undefined);

    const useCase = buildUseCase(conversationRepo, userRepo, transitionState, messagingPort);
    await useCase.execute();

    expect(mockShowTimeoutWarning).toHaveBeenCalledTimes(2);

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Failed to send review timeout reminder',
        userId: 'user-1',
        channel: 'telegram',
        externalId: '111',
        error: 'Send failed',
      }),
    );
  });
});

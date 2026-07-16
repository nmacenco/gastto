// LAYER: Application / Tests
// Unit tests for ConfirmCategories use case.
// Mocks all ports: ISpreadsheetConfigRepository, IUserRepository,
// MessagingOutputPort, TransitionConversationState.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConfirmCategories,
  type ConfirmCategoriesDeps,
  type ConfirmCategoriesInput,
} from './ConfirmCategories';
import type {
  ISpreadsheetConfigRepository,
  IUserRepository,
} from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { onboardingCopies } from '../../copies/onboarding.copies';

const mockFindByUserId = vi.fn();
const mockUpdateCategoriesConfirmed = vi.fn();
const mockUpdateStatus = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockTransitionExecute = vi.fn();

function buildMockDeps(overrides: Partial<ConfirmCategoriesDeps> = {}): ConfirmCategoriesDeps {
  return {
    spreadsheetConfigRepository: {
      findByUserId: mockFindByUserId,
      updateCategoriesConfirmed: mockUpdateCategoriesConfirmed,
    } as unknown as ISpreadsheetConfigRepository,
    userRepository: {
      updateStatus: mockUpdateStatus,
    } as unknown as IUserRepository,
    messagingPort: { sendMessage: mockSendMessage },
    transitionState: {
      execute: mockTransitionExecute,
    } as unknown as TransitionConversationState,
    ...overrides,
  };
}

const baseInput: ConfirmCategoriesInput = {
  userId: 'user-123',
  externalId: '987654321',
  channel: 'telegram',
  statePayload: { categories: ['comida', 'transporte'] },
};

const mockConfig = {
  id: 'config-1',
  userId: 'user-123',
  provider: 'google' as const,
  fileId: 'file-123',
  fileName: 'Mi Planilla',
  sheetName: 'Gastos',
  accessVerifiedAt: new Date(),
  categoriesConfirmedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFindByUserId.mockResolvedValue(mockConfig);
  mockUpdateCategoriesConfirmed.mockResolvedValue(undefined);
  mockUpdateStatus.mockResolvedValue(undefined);
  mockTransitionExecute.mockResolvedValue({
    userId: 'user-123',
    currentState: 'IDLE',
    statePayload: null,
    enteredAt: new Date(),
    expiresAt: null,
    updatedAt: new Date(),
  });
});

describe('ConfirmCategories', () => {
  it('marks categories confirmed, activates user, transitions to IDLE, and sends welcome message', async () => {
    const deps = buildMockDeps();
    const useCase = new ConfirmCategories(deps);

    const result = await useCase.execute(baseInput);

    expect(mockUpdateCategoriesConfirmed).toHaveBeenCalledWith('config-1');
    expect(mockUpdateStatus).toHaveBeenCalledWith('user-123', 'active');
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'IDLE',
    });
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.onboardingComplete(),
    );
    expect(result.nextState).toBe('IDLE');
    expect(result.message).toBe(onboardingCopies.onboardingComplete());
  });

  it('is idempotent when categories are already confirmed', async () => {
    mockFindByUserId.mockResolvedValue({
      ...mockConfig,
      categoriesConfirmedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const deps = buildMockDeps();
    const useCase = new ConfirmCategories(deps);

    const result = await useCase.execute(baseInput);

    expect(mockUpdateCategoriesConfirmed).not.toHaveBeenCalled();
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockTransitionExecute).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.onboardingComplete(),
    );
    expect(result.nextState).toBe('IDLE');
  });

  it('sends reconnect message when spreadsheet config is missing', async () => {
    mockFindByUserId.mockResolvedValue(null);
    const deps = buildMockDeps();
    const useCase = new ConfirmCategories(deps);

    const result = await useCase.execute(baseInput);

    expect(mockUpdateCategoriesConfirmed).not.toHaveBeenCalled();
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', onboardingCopies.reconnectAccount());
    expect(result.nextState).toBe('ONBOARDING_START');
  });
});

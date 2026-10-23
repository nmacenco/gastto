// LAYER: Application / Tests

import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';
import { onboardingCopies } from '../../copies/onboarding.copies';

const mockFindConfigByUserId = vi.fn();
const mockUpdateCategoriesConfirmed = vi.fn();
const mockFindVocabulary = vi.fn();
const mockSaveVocabulary = vi.fn();
const mockUpdateStatus = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockTransitionExecute = vi.fn();

function buildMockDeps(overrides: Partial<ConfirmCategoriesDeps> = {}): ConfirmCategoriesDeps {
  return {
    spreadsheetConfigRepository: {
      findByUserId: mockFindConfigByUserId,
      updateCategoriesConfirmed: mockUpdateCategoriesConfirmed,
    } as unknown as ISpreadsheetConfigRepository,
    categoryVocabularyRepository: {
      findBySpreadsheetId: mockFindVocabulary,
      save: mockSaveVocabulary,
    },
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

const legacyInput: ConfirmCategoriesInput = {
  userId: 'user-123',
  externalId: '987654321',
  channel: 'telegram',
  statePayload: { categories: ['Food', 'Leisure'] },
};

const hierarchyInput: ConfirmCategoriesInput = {
  ...legacyInput,
  statePayload: {
    headerRowIndex: 3,
    categories: [
      { name: 'Food', subcategories: ['Restaurant'] },
      { name: 'Leisure', subcategories: ['Restaurant', 'Cinema'] },
    ],
    orphanSubcategories: ['Unassigned'],
    subcategoryColumnMapped: true,
  },
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
  mockFindConfigByUserId.mockResolvedValue(mockConfig);
  mockFindVocabulary.mockResolvedValue(null);
  mockSaveVocabulary.mockResolvedValue(undefined);
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
  it('saves the complete hierarchy before timestamp, activation, IDLE, and completion', async () => {
    const result = await new ConfirmCategories(buildMockDeps()).execute(hierarchyInput);
    const saved = mockSaveVocabulary.mock.calls[0]![0] as CategoryVocabulary;
    const [food, leisure] = saved.getCategories();

    expect(saved.spreadsheetId).toBe('config-1');
    expect(saved.getSubcategories(food?.id)).toHaveLength(1);
    expect(saved.getSubcategories(leisure?.id)).toHaveLength(2);
    expect(saved.getSubcategories().map((child) => child.name)).not.toContain('Unassigned');
    expect(mockUpdateCategoriesConfirmed).toHaveBeenCalledWith('config-1');
    expect(mockUpdateStatus).toHaveBeenCalledWith('user-123', 'active');
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
    });
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.onboardingComplete(),
    );
    expect(result).toEqual({
      nextState: 'IDLE',
      message: onboardingCopies.onboardingComplete(),
    });

    const order = [
      mockSaveVocabulary,
      mockUpdateCategoriesConfirmed,
      mockUpdateStatus,
      mockTransitionExecute,
      mockSendMessage,
    ].map((mock) => mock.mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('upgrades and persists a legacy flat payload without subcategories', async () => {
    await new ConfirmCategories(buildMockDeps()).execute(legacyInput);
    const saved = mockSaveVocabulary.mock.calls[0]![0] as CategoryVocabulary;

    expect(saved.getCategories().map((category) => category.name)).toEqual(['Food', 'Leisure']);
    expect(saved.getSubcategories()).toEqual([]);
  });

  it('preserves stable ids and moves one uniquely identifiable existing child', async () => {
    const persisted = new CategoryVocabulary(
      'config-1',
      [
        { id: 'cat-food', name: 'Food', normalizedName: 'food' },
        { id: 'cat-leisure', name: 'Leisure', normalizedName: 'leisure' },
      ],
      [
        {
          id: 'sub-restaurant',
          categoryId: 'cat-food',
          name: 'Restaurant',
          normalizedName: 'restaurant',
        },
      ],
    );
    mockFindVocabulary.mockResolvedValue(persisted);
    const input: ConfirmCategoriesInput = {
      ...hierarchyInput,
      statePayload: {
        categories: [
          { name: 'Food', subcategories: [] },
          { name: 'Leisure', subcategories: ['Restaurant'] },
        ],
        orphanSubcategories: [],
        subcategoryColumnMapped: true,
      },
    };

    await new ConfirmCategories(buildMockDeps()).execute(input);
    const saved = mockSaveVocabulary.mock.calls[0]![0] as CategoryVocabulary;

    expect(saved.getCategories().map((category) => category.id)).toEqual([
      'cat-food',
      'cat-leisure',
    ]);
    expect(saved.findSubcategory('cat-leisure', 'Restaurant')).toMatchObject({
      id: 'sub-restaurant',
      categoryId: 'cat-leisure',
    });
    expect(saved.findSubcategory('cat-food', 'Restaurant')).toBeUndefined();
  });

  it('re-saves idempotently and restores active IDLE when already confirmed', async () => {
    mockFindConfigByUserId.mockResolvedValue({
      ...mockConfig,
      categoriesConfirmedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const persisted = new CategoryVocabulary('config-1');
    persisted.addCategory('Food');
    persisted.addCategory('Leisure');
    mockFindVocabulary.mockResolvedValue(persisted);

    await new ConfirmCategories(buildMockDeps()).execute(legacyInput);

    expect(mockSaveVocabulary).toHaveBeenCalledWith(persisted);
    expect(mockUpdateCategoriesConfirmed).not.toHaveBeenCalled();
    expect(mockUpdateStatus).toHaveBeenCalledWith('user-123', 'active');
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
    });
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    { categories: [] },
    {
      categories: [{ name: 'Food', subcategories: 'Restaurant' }],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    },
  ])('recovers an absent, empty, or malformed proposal: %#', async (statePayload) => {
    const result = await new ConfirmCategories(buildMockDeps()).execute({
      ...legacyInput,
      statePayload,
    });

    expect(mockFindVocabulary).not.toHaveBeenCalled();
    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(mockUpdateCategoriesConfirmed).not.toHaveBeenCalled();
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_CATEGORIES',
      payload: null,
    });
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.categoryProposalUnavailable(),
    );
    expect(result.nextState).toBe('ONBOARDING_CATEGORIES');
  });

  it('stops finalization when the aggregate transaction fails', async () => {
    mockSaveVocabulary.mockRejectedValue(new Error('aggregate rollback'));

    await expect(new ConfirmCategories(buildMockDeps()).execute(hierarchyInput)).rejects.toThrow(
      'aggregate rollback',
    );

    expect(mockUpdateCategoriesConfirmed).not.toHaveBeenCalled();
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockTransitionExecute).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('does not report completion when activation fails', async () => {
    mockUpdateStatus.mockRejectedValue(new Error('activation failed'));

    await expect(new ConfirmCategories(buildMockDeps()).execute(hierarchyInput)).rejects.toThrow(
      'activation failed',
    );

    expect(mockSaveVocabulary).toHaveBeenCalledOnce();
    expect(mockUpdateCategoriesConfirmed).toHaveBeenCalledOnce();
    expect(mockTransitionExecute).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('does not report completion when the IDLE transition fails', async () => {
    mockTransitionExecute.mockRejectedValue(new Error('transition failed'));

    await expect(new ConfirmCategories(buildMockDeps()).execute(hierarchyInput)).rejects.toThrow(
      'transition failed',
    );

    expect(mockSaveVocabulary).toHaveBeenCalledOnce();
    expect(mockUpdateCategoriesConfirmed).toHaveBeenCalledOnce();
    expect(mockUpdateStatus).toHaveBeenCalledOnce();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('sends reconnect guidance without touching hierarchy or activation when config is missing', async () => {
    mockFindConfigByUserId.mockResolvedValue(null);

    const result = await new ConfirmCategories(buildMockDeps()).execute(hierarchyInput);

    expect(mockFindVocabulary).not.toHaveBeenCalled();
    expect(mockSaveVocabulary).not.toHaveBeenCalled();
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

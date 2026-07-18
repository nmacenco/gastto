// LAYER: Application / Tests
// Unit tests for ModifyCategoryVocabulary use case.
// Mocks all ports: parser, repositories, messaging, transition.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ModifyCategoryVocabulary,
  type ModifyCategoryVocabularyDeps,
  type ModifyCategoryVocabularyInput,
} from './ModifyCategoryVocabulary';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';
import { onboardingCopies } from '../../copies/onboarding.copies';

const mockParse = vi.fn();
const mockFindConfigByUserId = vi.fn();
const mockFindVocabularyBySpreadsheetId = vi.fn();
const mockSaveVocabulary = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockTransitionExecute = vi.fn();

function buildMockDeps(
  overrides: Partial<ModifyCategoryVocabularyDeps> = {},
): ModifyCategoryVocabularyDeps {
  return {
    categoryModificationParser: {
      parse: mockParse,
    },
    spreadsheetConfigRepository: {
      findByUserId: mockFindConfigByUserId,
      create: vi.fn(),
      upsertByUserId: vi.fn(),
      updateAccessVerified: vi.fn(),
      updateCategoriesConfirmed: vi.fn(),
    },
    categoryVocabularyRepository: {
      findBySpreadsheetId: mockFindVocabularyBySpreadsheetId,
      save: mockSaveVocabulary,
    },
    messagingPort: { sendMessage: mockSendMessage },
    transitionState: {
      execute: mockTransitionExecute,
    } as unknown as TransitionConversationState,
    ...overrides,
  };
}

const baseInput: ModifyCategoryVocabularyInput = {
  userId: 'user-123',
  externalId: '987654321',
  channel: 'telegram',
  rawMessage: 'falta Salud',
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
  mockFindConfigByUserId.mockResolvedValue(mockConfig);
  mockTransitionExecute.mockResolvedValue(undefined);
});

describe('ModifyCategoryVocabulary', () => {
  it('adds a category and returns the updated list', async () => {
    mockParse.mockResolvedValue({ kind: 'add', name: 'salud' });
    const vocab = new CategoryVocabulary('config-1');
    vocab.addCategory('comida');
    vocab.addCategory('transporte');
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocab);

    const deps = buildMockDeps();
    const useCase = new ModifyCategoryVocabulary(deps);

    const result = await useCase.execute(baseInput);

    expect(mockSaveVocabulary).toHaveBeenCalledTimes(1);
    expect(result.categories).toContain('comida');
    expect(result.categories).toContain('transporte');
    expect(result.categories).toContain('salud');
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', expect.stringContaining('salud'));
    expect(mockTransitionExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        targetState: 'ONBOARDING_CATEGORIES',
      }),
    );
  });

  it('renames a category and returns the updated list', async () => {
    mockParse.mockResolvedValue({ kind: 'rename', from: 'comida', to: 'alimentacion' });
    const vocab = new CategoryVocabulary('config-1');
    vocab.addCategory('comida');
    vocab.addCategory('transporte');
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocab);

    const deps = buildMockDeps();
    const useCase = new ModifyCategoryVocabulary(deps);

    const result = await useCase.execute(baseInput);

    expect(mockSaveVocabulary).toHaveBeenCalledTimes(1);
    expect(result.categories).toContain('alimentacion');
    expect(result.categories).not.toContain('comida');
    expect(result.categories).toContain('transporte');
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      expect.stringContaining('alimentacion'),
    );
    expect(mockTransitionExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        targetState: 'ONBOARDING_CATEGORIES',
      }),
    );
  });

  it('returns current categories with unknown intent and does not persist', async () => {
    mockParse.mockResolvedValue({ kind: 'unknown' });
    const vocab = new CategoryVocabulary('config-1');
    vocab.addCategory('comida');
    vocab.addCategory('transporte');
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocab);

    const deps = buildMockDeps();
    const useCase = new ModifyCategoryVocabulary(deps);

    const result = await useCase.execute({ ...baseInput, rawMessage: 'hello world' });

    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(result.categories).toEqual(['comida', 'transporte']);
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', expect.stringContaining('comida'));
    expect(mockTransitionExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        targetState: 'ONBOARDING_CATEGORIES',
      }),
    );
  });

  it('rejects duplicate name on add and returns error message', async () => {
    mockParse.mockResolvedValue({ kind: 'add', name: 'comida' });
    const vocab = new CategoryVocabulary('config-1');
    vocab.addCategory('comida');
    vocab.addCategory('transporte');
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocab);

    const deps = buildMockDeps();
    const useCase = new ModifyCategoryVocabulary(deps);

    const result = await useCase.execute(baseInput);

    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(result.categories).toEqual(['comida', 'transporte']);
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', expect.stringContaining('comida'));
  });

  it('rejects duplicate name on rename and returns error message', async () => {
    mockParse.mockResolvedValue({ kind: 'rename', from: 'comida', to: 'transporte' });
    const vocab = new CategoryVocabulary('config-1');
    vocab.addCategory('comida');
    vocab.addCategory('transporte');
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocab);

    const deps = buildMockDeps();
    const useCase = new ModifyCategoryVocabulary(deps);

    const result = await useCase.execute(baseInput);

    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(result.categories).toEqual(['comida', 'transporte']);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      expect.stringContaining('transporte'),
    );
  });

  it('sends reconnect message when spreadsheet config is missing', async () => {
    mockFindConfigByUserId.mockResolvedValue(null);
    const deps = buildMockDeps();
    const useCase = new ModifyCategoryVocabulary(deps);

    const result = await useCase.execute(baseInput);

    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', onboardingCopies.reconnectAccount());
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });
    expect(result.categories).toEqual(['comida', 'transporte']);
  });

  it('returns not-found message when rename target does not exist', async () => {
    mockParse.mockResolvedValue({ kind: 'rename', from: 'inexistente', to: 'nuevo' });
    const vocab = new CategoryVocabulary('config-1');
    vocab.addCategory('comida');
    vocab.addCategory('transporte');
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocab);

    const deps = buildMockDeps();
    const useCase = new ModifyCategoryVocabulary(deps);

    const result = await useCase.execute(baseInput);

    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(result.categories).toEqual(['comida', 'transporte']);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      expect.stringContaining('inexistente'),
    );
    expect(mockTransitionExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        targetState: 'ONBOARDING_CATEGORIES',
      }),
    );
  });

  it('rebuilds vocabulary from payload when none exists in repository', async () => {
    mockParse.mockResolvedValue({ kind: 'add', name: 'salud' });
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(null);

    const deps = buildMockDeps();
    const useCase = new ModifyCategoryVocabulary(deps);

    const result = await useCase.execute(baseInput);

    expect(mockSaveVocabulary).toHaveBeenCalledTimes(1);
    expect(result.categories).toContain('comida');
    expect(result.categories).toContain('transporte');
    expect(result.categories).toContain('salud');
  });
});

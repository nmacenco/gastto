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

const hierarchyInput: ModifyCategoryVocabularyInput = {
  ...baseInput,
  statePayload: {
    headerRowIndex: 3,
    categories: [
      { name: 'Food', subcategories: ['Delivery', 'Groceries'] },
      { name: 'Utilities', subcategories: ['Streaming'] },
      { name: 'Leisure', subcategories: ['Cinema'] },
    ],
    orphanSubcategories: ['Unassigned'],
    subcategoryColumnMapped: true,
  },
};

function buildHierarchyVocabulary(): CategoryVocabulary {
  const vocabulary = new CategoryVocabulary('config-1');
  const food = vocabulary.addCategory('Food');
  const utilities = vocabulary.addCategory('Utilities');
  const leisure = vocabulary.addCategory('Leisure');
  vocabulary.addSubcategory(food.id, 'Delivery');
  vocabulary.addSubcategory(food.id, 'Groceries');
  vocabulary.addSubcategory(utilities.id, 'Streaming');
  vocabulary.addSubcategory(leisure.id, 'Cinema');
  return vocabulary;
}

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

  it('removes a category and returns the updated list', async () => {
    mockParse.mockResolvedValue({ kind: 'remove', name: 'ocio' });
    const vocab = new CategoryVocabulary('config-1');
    vocab.addCategory('comida');
    vocab.addCategory('ocio');
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocab);

    const useCase = new ModifyCategoryVocabulary(buildMockDeps());
    const result = await useCase.execute({ ...baseInput, rawMessage: 'quitar ocio' });

    expect(mockSaveVocabulary).toHaveBeenCalledTimes(1);
    expect(result.categories).toEqual(['comida']);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      expect.not.stringContaining('• ocio'),
    );
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_CATEGORIES',
      payload: {
        categories: [{ name: 'comida', subcategories: [] }],
        orphanSubcategories: [],
        subcategoryColumnMapped: false,
      },
    });
  });

  it('does not persist when the category to remove does not exist', async () => {
    mockParse.mockResolvedValue({ kind: 'remove', name: 'inexistente' });
    const vocab = new CategoryVocabulary('config-1');
    vocab.addCategory('comida');
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocab);

    const useCase = new ModifyCategoryVocabulary(buildMockDeps());
    const result = await useCase.execute({ ...baseInput, rawMessage: 'quitar inexistente' });

    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(result.categories).toEqual(['comida']);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      expect.stringContaining('inexistente'),
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

  it('adds a child under its exact active parent and preserves payload metadata', async () => {
    mockParse.mockResolvedValue({ kind: 'add-subcategory', name: 'Takeout', parent: 'food' });
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(buildHierarchyVocabulary());

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);

    expect(result.state.categories[0]).toEqual({
      name: 'Food',
      subcategories: ['Delivery', 'Groceries', 'Takeout'],
    });
    expect(result.state.orphanSubcategories).toEqual(['Unassigned']);
    expect(mockSaveVocabulary).toHaveBeenCalledOnce();
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_CATEGORIES',
      payload: {
        headerRowIndex: 3,
        categories: result.state.categories,
        orphanSubcategories: ['Unassigned'],
        subcategoryColumnMapped: true,
      },
    });
  });

  it('allows the same child name under a different parent', async () => {
    mockParse.mockResolvedValue({ kind: 'add-subcategory', name: 'Cinema', parent: 'Food' });
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(buildHierarchyVocabulary());

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);

    expect(
      result.state.categories.find((category) => category.name === 'Food')?.subcategories,
    ).toContain('Cinema');
    expect(
      result.state.categories.find((category) => category.name === 'Leisure')?.subcategories,
    ).toContain('Cinema');
    expect(mockSaveVocabulary).toHaveBeenCalledOnce();
  });

  it('renames only the selected child and preserves its stable id', async () => {
    mockParse.mockResolvedValue({
      kind: 'rename-subcategory',
      from: 'Delivery',
      to: 'Takeout',
      parent: 'Food',
    });
    const vocabulary = buildHierarchyVocabulary();
    const food = vocabulary.getCategories().find((category) => category.name === 'Food')!;
    const childId = vocabulary.findSubcategory(food.id, 'Delivery')!.id;
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocabulary);

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);
    const saved = mockSaveVocabulary.mock.calls[0]![0] as CategoryVocabulary;

    expect(saved.findSubcategory(food.id, 'Takeout')?.id).toBe(childId);
    expect(result.state.categories[0]?.subcategories).toEqual(['Takeout', 'Groceries']);
  });

  it('moves one child between parents while preserving its id and source isolation', async () => {
    mockParse.mockResolvedValue({
      kind: 'move-subcategory',
      name: 'Streaming',
      fromParent: 'Utilities',
      toParent: 'Leisure',
    });
    const vocabulary = buildHierarchyVocabulary();
    const utilities = vocabulary.getCategories().find((category) => category.name === 'Utilities')!;
    const leisure = vocabulary.getCategories().find((category) => category.name === 'Leisure')!;
    const childId = vocabulary.findSubcategory(utilities.id, 'Streaming')!.id;
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocabulary);

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);
    const saved = mockSaveVocabulary.mock.calls[0]![0] as CategoryVocabulary;

    expect(saved.findSubcategory(utilities.id, 'Streaming')).toBeUndefined();
    expect(saved.findSubcategory(leisure.id, 'Streaming')?.id).toBe(childId);
    expect(result.state.categories[1]?.subcategories).toEqual([]);
    expect(result.state.categories[2]?.subcategories).toEqual(['Streaming', 'Cinema']);
  });

  it('removes only the requested child', async () => {
    mockParse.mockResolvedValue({
      kind: 'remove-subcategory',
      name: 'Cinema',
      parent: 'Leisure',
    });
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(buildHierarchyVocabulary());

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);

    expect(result.state.categories[2]).toEqual({ name: 'Leisure', subcategories: [] });
    expect(result.state.categories[0]?.subcategories).toEqual(['Delivery', 'Groceries']);
    expect(mockSaveVocabulary).toHaveBeenCalledOnce();
  });

  it('removes a category together with its complete child branch', async () => {
    mockParse.mockResolvedValue({ kind: 'remove', name: 'Food' });
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(buildHierarchyVocabulary());

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);
    const saved = mockSaveVocabulary.mock.calls[0]![0] as CategoryVocabulary;

    expect(result.state.categories.map((category) => category.name)).toEqual([
      'Utilities',
      'Leisure',
    ]);
    expect(saved.getSubcategories().map((subcategory) => subcategory.name)).toEqual([
      'Streaming',
      'Cinema',
    ]);
  });

  it('rejects a missing parent and lists valid parent candidates without persistence', async () => {
    mockParse.mockResolvedValue({
      kind: 'add-subcategory',
      name: 'Takeout',
      parent: 'Missing',
    });
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(buildHierarchyVocabulary());

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);

    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(result.message).toContain('"Missing"');
    expect(result.message).toContain('• Food');
    expect(result.message).toContain('• Utilities');
    expect(result.state.categories[0]?.subcategories).toEqual(['Delivery', 'Groceries']);
  });

  it('defensively rejects an ambiguous parent without persistence', async () => {
    mockParse.mockResolvedValue({
      kind: 'add-subcategory',
      name: 'Takeout',
      parent: 'Food',
    });
    const vocabulary = new CategoryVocabulary('config-1', [
      { id: 'food-1', name: 'Food', normalizedName: 'food' },
      { id: 'food-2', name: 'FOOD', normalizedName: 'food' },
    ]);
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocabulary);

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);

    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(result.message).toContain('ambigua');
    expect(result.message).toContain('• Food');
    expect(result.message).toContain('• FOOD');
  });

  it('rejects a missing child within the resolved parent without persistence', async () => {
    mockParse.mockResolvedValue({
      kind: 'remove-subcategory',
      name: 'Missing',
      parent: 'Food',
    });
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(buildHierarchyVocabulary());

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);

    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(result.message).toContain('"Missing"');
    expect(result.message).toContain('"Food"');
  });

  it('rejects duplicate children and move collisions without partial persistence', async () => {
    const vocabulary = buildHierarchyVocabulary();
    const leisure = vocabulary.getCategories().find((category) => category.name === 'Leisure')!;
    vocabulary.addSubcategory(leisure.id, 'Streaming');
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(vocabulary);
    mockParse.mockResolvedValue({
      kind: 'move-subcategory',
      name: 'Streaming',
      fromParent: 'Utilities',
      toParent: 'Leisure',
    });

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);

    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(result.message).toContain('colisión');
    expect(result.state.categories[1]?.subcategories).toEqual(['Streaming']);
    expect(result.state.categories[2]?.subcategories).toEqual(['Cinema', 'Streaming']);
  });

  it('rebuilds the complete hierarchy from a valid payload when no aggregate exists', async () => {
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(null);
    mockParse.mockResolvedValue({
      kind: 'rename-subcategory',
      from: 'Delivery',
      to: 'Takeout',
      parent: 'Food',
    });

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);

    expect(result.state.categories[0]).toEqual({
      name: 'Food',
      subcategories: ['Takeout', 'Groceries'],
    });
    expect(mockSaveVocabulary).toHaveBeenCalledOnce();
  });

  it('propagates repository failure before sending or transitioning', async () => {
    mockParse.mockResolvedValue({ kind: 'add-subcategory', name: 'Takeout', parent: 'Food' });
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(buildHierarchyVocabulary());
    mockSaveVocabulary.mockRejectedValueOnce(new Error('transaction rolled back'));

    await expect(
      new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput),
    ).rejects.toThrow('transaction rolled back');

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockTransitionExecute).not.toHaveBeenCalled();
  });

  it('treats a repeated child command idempotently and does not persist again', async () => {
    mockParse.mockResolvedValue({ kind: 'add-subcategory', name: 'Delivery', parent: 'Food' });
    mockFindVocabularyBySpreadsheetId.mockResolvedValue(buildHierarchyVocabulary());

    const result = await new ModifyCategoryVocabulary(buildMockDeps()).execute(hierarchyInput);

    expect(mockSaveVocabulary).not.toHaveBeenCalled();
    expect(result.message).toContain('duplicado');
    expect(result.state.categories[0]?.subcategories).toEqual(['Delivery', 'Groceries']);
  });
});

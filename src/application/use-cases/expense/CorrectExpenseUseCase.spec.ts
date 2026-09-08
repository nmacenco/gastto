// LAYER: Application / Tests
// Unit tests for CorrectExpenseUseCase.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { CorrectExpenseUseCase } from './CorrectExpenseUseCase';
import { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type { LLMPort } from '../../../domain/ports/services';
import type { CorrectExpenseOutcome } from './CorrectExpenseUseCase';
import type {
  ICategoryVocabularyRepository,
  IExpenseRecordRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import type { ICategoryClassifier } from '../../ports/in/categoryClassifier.port';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import {
  ClassificationSelection,
  HierarchicalClassificationResult,
  SubcategoryClassificationSelection,
} from '../../../domain/value-objects/ClassificationResult';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';

function buildExtractedExpense(overrides: Partial<ExtractedExpense> = {}): ExtractedExpense {
  return {
    monto: 12,
    moneda: 'EUR',
    categoriaRaw: 'Comida',
    subcategoriaRaw: null,
    fechaRaw: '2026-07-25',
    medioPago: null,
    confianzaCategoria: 'alta',
    confianzaSubcategoria: 'nula',
    ...overrides,
  };
}

function buildReviewPayload(overrides: Partial<ExpenseReviewPayload> = {}): ExpenseReviewPayload {
  return {
    extracted: buildExtractedExpense(),
    rawMessage: 'Cafe 12 EUR',
    resolvedDate: '2026-07-25',
    resolvedCategory: 'Comida',
    resolvedCategoryId: null,
    categoryStatus: 'confirmed',
    ...overrides,
  };
}

function buildCorrectionState(
  payload: ExpenseReviewPayload = buildReviewPayload(),
  cycles = 0,
): ExpenseCorrectionState {
  return ExpenseCorrectionState.create(payload, cycles);
}

function getPayload(outcome: CorrectExpenseOutcome): ExpenseReviewPayload {
  assert('payload' in outcome, `unexpected outcome status: ${outcome.status}`);
  return outcome.payload;
}

function buildDeps(
  overrides: {
    interpretCorrection?: ReturnType<typeof vi.fn<LLMPort['interpretCorrection']>>;
    classifier?: ReturnType<typeof vi.fn<ICategoryClassifier['execute']>>;
    findAverageAmountByUserId?: ReturnType<
      typeof vi.fn<IExpenseRecordRepository['findAverageAmountByUserId']>
    >;
    findByUserId?: ReturnType<typeof vi.fn<ISpreadsheetConfigRepository['findByUserId']>>;
    findCategoryVocabulary?: ReturnType<
      typeof vi.fn<ICategoryVocabularyRepository['findBySpreadsheetId']>
    >;
    transition?: ReturnType<typeof vi.fn<TransitionConversationState['execute']>>;
  } = {},
) {
  const interpretCorrectionMock: ReturnType<typeof vi.fn<LLMPort['interpretCorrection']>> =
    overrides.interpretCorrection ??
    vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
      intent: 'correction',
      changedFields: ['monto'],
      monto: 15,
      moneda: null,
      categoriaRaw: null,
      subcategoriaRaw: null,
      fechaRaw: null,
    });

  const classifierMock: ReturnType<typeof vi.fn<ICategoryClassifier['execute']>> =
    overrides.classifier ??
    vi
      .fn<ICategoryClassifier['execute']>()
      .mockResolvedValue(HierarchicalClassificationResult.none());

  const findAverageAmountByUserIdMock: ReturnType<
    typeof vi.fn<IExpenseRecordRepository['findAverageAmountByUserId']>
  > =
    overrides.findAverageAmountByUserId ??
    vi.fn<IExpenseRecordRepository['findAverageAmountByUserId']>().mockResolvedValue(null);

  const findByUserIdMock: ReturnType<typeof vi.fn<ISpreadsheetConfigRepository['findByUserId']>> =
    overrides.findByUserId ??
    vi.fn<ISpreadsheetConfigRepository['findByUserId']>().mockResolvedValue({
      id: 'sheet-1',
      userId: 'user-123',
      provider: 'google',
      fileId: 'file-1',
      fileName: 'Gastos.xlsx',
      sheetName: 'Gastos',
      accessVerifiedAt: new Date(),
      categoriesConfirmedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  const findCategoryVocabularyMock: ReturnType<
    typeof vi.fn<ICategoryVocabularyRepository['findBySpreadsheetId']>
  > =
    overrides.findCategoryVocabulary ??
    vi.fn<ICategoryVocabularyRepository['findBySpreadsheetId']>().mockResolvedValue(
      new CategoryVocabulary(
        'sheet-1',
        [
          { id: 'cat-1', name: 'Comida', normalizedName: 'comida' },
          { id: 'cat-2', name: 'Transporte', normalizedName: 'transporte' },
        ],
        [
          {
            id: 'sub-1',
            categoryId: 'cat-1',
            name: 'Restaurante',
            normalizedName: 'restaurante',
          },
          {
            id: 'sub-2',
            categoryId: 'cat-1',
            name: 'Supermercado',
            normalizedName: 'supermercado',
          },
          {
            id: 'sub-3',
            categoryId: 'cat-2',
            name: 'Peajes',
            normalizedName: 'peajes',
          },
        ],
      ),
    );

  const transitionMock: ReturnType<typeof vi.fn<TransitionConversationState['execute']>> =
    overrides.transition ??
    vi.fn<TransitionConversationState['execute']>().mockResolvedValue({
      userId: 'user-123',
      currentState: 'EXPENSE_REVIEW',
      statePayload: null,
      expiresAt: null,
      enteredAt: new Date(),
      updatedAt: new Date(),
    });

  const llm = {
    extractExpense: vi.fn(),
    generateResponse: vi.fn(),
    interpretCorrection: interpretCorrectionMock,
  } as unknown as LLMPort;
  const classifier = { execute: classifierMock } as unknown as ICategoryClassifier;
  const expenseRepo = {
    findAverageAmountByUserId: findAverageAmountByUserIdMock,
  } as unknown as IExpenseRecordRepository;
  const spreadsheetConfigRepo = {
    findByUserId: findByUserIdMock,
  } as unknown as ISpreadsheetConfigRepository;
  const categoryVocabularyRepo = {
    findBySpreadsheetId: findCategoryVocabularyMock,
  } as unknown as ICategoryVocabularyRepository;
  const transitionState = { execute: transitionMock } as unknown as TransitionConversationState;

  return {
    useCase: new CorrectExpenseUseCase(
      {
        llm,
        classifier,
        expenseRepo,
        spreadsheetConfigRepo,
        categoryVocabularyRepo,
        transitionState,
      },
      10,
    ),
    interpretCorrectionMock,
    classifierMock,
    findAverageAmountByUserIdMock,
    findByUserIdMock,
    findCategoryVocabularyMock,
    transitionMock,
  };
}

describe('CorrectExpenseUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates amount when the user corrects it', async () => {
    const { useCase, transitionMock } = buildDeps();
    const state = buildCorrectionState();

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'no, fueron 15',
      state,
      channel: 'telegram',
    });

    expect(result.status).toBe('corrected');
    const payload = getPayload(result);
    expect(payload.extracted.monto).toBe(15);
    expect(payload.extracted.moneda).toBe('EUR');
    expect(transitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        targetState: 'EXPENSE_REVIEW',
      }),
    );
  });

  it('updates currency while preserving the original expense context', async () => {
    const { useCase, interpretCorrectionMock } = buildDeps({
      interpretCorrection: vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
        intent: 'correction',
        changedFields: ['moneda'],
        monto: null,
        moneda: 'USD',
        categoriaRaw: null,
        subcategoriaRaw: null,
        fechaRaw: null,
      }),
    });
    const state = buildCorrectionState(
      buildReviewPayload({
        rawMessage: 'Almuerzo 12 EUR',
        resolvedDate: '2026-07-25',
      }),
    );

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'en realidad fueron dólares',
      state,
      channel: 'telegram',
    });

    expect(result.status).toBe('corrected');
    const payload = getPayload(result);
    expect(payload.extracted.moneda).toBe('USD');
    expect(payload.rawMessage).toBe('Almuerzo 12 EUR');
    expect(payload.resolvedDate).toBe('2026-07-25');
    expect(interpretCorrectionMock).toHaveBeenCalledWith(
      'en realidad fueron dólares',
      state.payload.extracted,
      expect.any(Object),
    );
  });

  it('updates category through the classifier', async () => {
    const { useCase, classifierMock, transitionMock } = buildDeps({
      interpretCorrection: vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
        intent: 'correction',
        changedFields: ['categoria'],
        monto: null,
        moneda: null,
        categoriaRaw: 'transporte',
        subcategoriaRaw: null,
        fechaRaw: null,
      }),
      classifier: vi
        .fn<ICategoryClassifier['execute']>()
        .mockResolvedValue(
          HierarchicalClassificationResult.create(
            ClassificationSelection.confirmed('category-transport', 'Transporte'),
          ),
        ),
    });
    const state = buildCorrectionState();

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'ponlo en transporte',
      state,
      channel: 'telegram',
    });

    expect(result.status).toBe('corrected');
    const payload = getPayload(result);
    expect(payload.resolvedCategory).toBe('Transporte');
    expect(payload.categoryStatus).toBe('confirmed');
    expect(classifierMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        rawMessage: 'ponlo en transporte',
        llmCategory: 'transporte',
        llmConfidence: 'alta',
        llmSubcategory: null,
        llmSubcategoryConfidence: 'nula',
      }),
    );
    expect(transitionMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetState: 'EXPENSE_REVIEW' }),
    );
  });

  it('updates date to previous day when the user says "ayer"', async () => {
    const { useCase, transitionMock } = buildDeps({
      interpretCorrection: vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
        intent: 'correction',
        changedFields: ['fecha'],
        monto: null,
        moneda: null,
        categoriaRaw: null,
        subcategoriaRaw: null,
        fechaRaw: 'ayer',
      }),
    });
    const state = buildCorrectionState();

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'fue ayer',
      state,
      channel: 'telegram',
    });

    expect(result.status).toBe('corrected');
    const expectedYesterday = new Date();
    expectedYesterday.setDate(expectedYesterday.getDate() - 1);
    expect(getPayload(result).resolvedDate).toBe(expectedYesterday.toISOString().slice(0, 10));
    expect(transitionMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetState: 'EXPENSE_REVIEW' }),
    );
  });

  it('updates multiple fields in a single execution', async () => {
    const { useCase, classifierMock, transitionMock } = buildDeps({
      interpretCorrection: vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
        intent: 'correction',
        changedFields: ['monto', 'categoria'],
        monto: 15,
        moneda: null,
        categoriaRaw: 'transporte',
        subcategoriaRaw: null,
        fechaRaw: null,
      }),
      classifier: vi
        .fn<ICategoryClassifier['execute']>()
        .mockResolvedValue(
          HierarchicalClassificationResult.create(
            ClassificationSelection.confirmed('category-transport', 'Transporte'),
          ),
        ),
    });
    const state = buildCorrectionState();

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'no, fueron 15 y es transporte',
      state,
      channel: 'telegram',
    });

    expect(result.status).toBe('corrected');
    const payload = getPayload(result);
    expect(payload.extracted.monto).toBe(15);
    expect(payload.resolvedCategory).toBe('Transporte');
    expect(classifierMock).toHaveBeenCalledTimes(1);
    expect(transitionMock).toHaveBeenCalledTimes(1);
  });

  it('returns not_interpretable for unrelated messages and does not transition', async () => {
    const { useCase, transitionMock, interpretCorrectionMock } = buildDeps({
      interpretCorrection: vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
        intent: 'unrelated',
        changedFields: [],
        monto: null,
        moneda: null,
        categoriaRaw: null,
        subcategoriaRaw: null,
        fechaRaw: null,
      }),
    });
    const state = buildCorrectionState();

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'uh-huh',
      state,
      channel: 'telegram',
    });

    expect(result.status).toBe('not_interpretable');
    expect(transitionMock).not.toHaveBeenCalled();
    expect(interpretCorrectionMock).toHaveBeenCalledWith(
      'uh-huh',
      state.payload.extracted,
      expect.any(Object),
    );
  });

  it('returns new_expense without changing the correction state', async () => {
    const { useCase, transitionMock } = buildDeps({
      interpretCorrection: vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
        intent: 'new_expense',
        changedFields: [],
        monto: null,
        moneda: null,
        categoriaRaw: null,
        subcategoriaRaw: null,
        fechaRaw: null,
      }),
    });
    const state = buildCorrectionState();

    await expect(
      useCase.execute({
        userId: 'user-123',
        rawMessage: 'Taxi 12 EUR',
        state,
        channel: 'telegram',
      }),
    ).resolves.toEqual({ status: 'new_expense' });

    expect(transitionMock).not.toHaveBeenCalled();
  });

  it('applies a parent and child correction atomically with one classifier call', async () => {
    const interpretCorrection = vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
      intent: 'correction',
      changedFields: ['categoria', 'subcategoria'],
      monto: null,
      moneda: null,
      categoriaRaw: 'Transporte',
      subcategoriaRaw: 'Peajes',
      fechaRaw: null,
    });
    const classifier = vi.fn<ICategoryClassifier['execute']>().mockResolvedValue(
      HierarchicalClassificationResult.create(
        ClassificationSelection.confirmed('cat-2', 'Transporte'),
        SubcategoryClassificationSelection.confirmed('sub-3', 'Peajes', 'cat-2'),
      ),
    );
    const { useCase, classifierMock, transitionMock } = buildDeps({
      interpretCorrection,
      classifier,
    });
    const state = buildCorrectionState(
      buildReviewPayload({
        resolvedCategory: 'Comida',
        resolvedCategoryId: 'cat-1',
        resolvedSubcategory: 'Restaurante',
        resolvedSubcategoryId: 'sub-1',
        subcategoryStatus: 'confirmed',
        subcategoryEnabled: true,
      }),
    );

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'es Transporte, subcategoría Peajes',
      state,
      channel: 'telegram',
    });

    expect(result.status).toBe('corrected');
    expect(getPayload(result)).toEqual(
      expect.objectContaining({
        resolvedCategory: 'Transporte',
        resolvedCategoryId: 'cat-2',
        resolvedSubcategory: 'Peajes',
        resolvedSubcategoryId: 'sub-3',
        subcategoryStatus: 'confirmed',
      }),
    );
    expect(getPayload(result).extracted).toEqual(
      expect.objectContaining({
        categoriaRaw: 'Transporte',
        subcategoriaRaw: 'Peajes',
        confianzaSubcategoria: 'alta',
      }),
    );
    expect(classifierMock).toHaveBeenCalledOnce();
    expect(classifierMock).toHaveBeenCalledWith(
      expect.objectContaining({
        llmCategory: 'Transporte',
        llmSubcategory: 'Peajes',
        llmSubcategoryConfidence: 'alta',
      }),
    );
    expect(transitionMock).toHaveBeenCalledOnce();
  });

  it('rejects an invalid combined child atomically and preserves the complete state', async () => {
    const interpretCorrection = vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
      intent: 'correction',
      changedFields: ['monto', 'categoria', 'subcategoria'],
      monto: 99,
      moneda: null,
      categoriaRaw: 'Transporte',
      subcategoriaRaw: 'Restaurante',
      fechaRaw: null,
    });
    const classifier = vi.fn<ICategoryClassifier['execute']>().mockResolvedValue(
      HierarchicalClassificationResult.create(
        ClassificationSelection.confirmed('cat-2', 'Transporte'),
      ),
    );
    const { useCase, transitionMock, findAverageAmountByUserIdMock } = buildDeps({
      interpretCorrection,
      classifier,
    });
    const payload = buildReviewPayload({
      resolvedCategoryId: 'cat-1',
      resolvedSubcategory: 'Restaurante',
      resolvedSubcategoryId: 'sub-1',
      subcategoryStatus: 'confirmed',
      subcategoryEnabled: true,
      pendingHighAmountConfirmation: true,
      queueRegisteredCount: 2,
      immediateUndoExpenseId: 'expense-previous',
    });
    const state = buildCorrectionState(payload, 4);
    const snapshot = state.toPayload();

    await expect(
      useCase.execute({
        userId: 'user-123',
        rawMessage: 'fueron 99, Transporte, Restaurante',
        state,
        channel: 'telegram',
      }),
    ).resolves.toEqual({
      status: 'invalid_subcategory',
      parentCategory: 'Transporte',
      attemptedSubcategory: 'Restaurante',
      allowedSubcategories: ['Peajes'],
    });

    expect(state.toPayload()).toEqual(snapshot);
    expect(transitionMock).not.toHaveBeenCalled();
    expect(findAverageAmountByUserIdMock).not.toHaveBeenCalled();
  });

  it('resolves a child-only correction under the current active parent', async () => {
    const interpretCorrection = vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
      intent: 'correction',
      changedFields: ['subcategoria'],
      monto: null,
      moneda: null,
      categoriaRaw: null,
      subcategoriaRaw: 'Restaurante',
      fechaRaw: null,
    });
    const classifier = vi.fn<ICategoryClassifier['execute']>().mockResolvedValue(
      HierarchicalClassificationResult.create(
        ClassificationSelection.confirmed('cat-1', 'Comida'),
        SubcategoryClassificationSelection.confirmed('sub-1', 'Restaurante', 'cat-1'),
      ),
    );
    const { useCase, classifierMock } = buildDeps({ interpretCorrection, classifier });
    const state = buildCorrectionState(
      buildReviewPayload({
        resolvedCategoryId: 'cat-1',
        subcategoryEnabled: true,
      }),
    );

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'la subcategoría es Restaurante',
      state,
      channel: 'telegram',
    });

    expect(result.status).toBe('corrected');
    expect(getPayload(result).resolvedSubcategoryId).toBe('sub-1');
    expect(classifierMock).toHaveBeenCalledWith(
      expect.objectContaining({ llmCategory: 'Comida', llmSubcategory: 'Restaurante' }),
    );
  });

  it('rejects a child-only correction when the stored parent is stale', async () => {
    const interpretCorrection = vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
      intent: 'correction',
      changedFields: ['subcategoria'],
      monto: null,
      moneda: null,
      categoriaRaw: null,
      subcategoriaRaw: 'Restaurante',
      fechaRaw: null,
    });
    const { useCase, classifierMock, transitionMock } = buildDeps({ interpretCorrection });
    const state = buildCorrectionState(
      buildReviewPayload({
        resolvedCategory: 'Archivada',
        resolvedCategoryId: 'cat-stale',
        subcategoryEnabled: true,
      }),
      3,
    );

    await expect(
      useCase.execute({
        userId: 'user-123',
        rawMessage: 'la subcategoría es Restaurante',
        state,
        channel: 'telegram',
      }),
    ).resolves.toEqual({
      status: 'invalid_subcategory',
      parentCategory: 'Archivada',
      attemptedSubcategory: 'Restaurante',
      allowedSubcategories: [],
    });
    expect(classifierMock).not.toHaveBeenCalled();
    expect(transitionMock).not.toHaveBeenCalled();
    expect(state.correctionCycles).toBe(3);
  });

  it('rejects an equal-named child resolved under a different parent', async () => {
    const interpretCorrection = vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
      intent: 'correction',
      changedFields: ['subcategoria'],
      monto: null,
      moneda: null,
      categoriaRaw: null,
      subcategoriaRaw: 'Común',
      fechaRaw: null,
    });
    const classifier = vi.fn<ICategoryClassifier['execute']>().mockResolvedValue(
      HierarchicalClassificationResult.create(
        ClassificationSelection.confirmed('cat-1', 'Comida'),
        SubcategoryClassificationSelection.confirmed('sub-other', 'Común', 'cat-2'),
      ),
    );
    const { useCase, transitionMock } = buildDeps({ interpretCorrection, classifier });
    const state = buildCorrectionState(
      buildReviewPayload({ resolvedCategoryId: 'cat-1', subcategoryEnabled: true }),
    );

    await expect(
      useCase.execute({
        userId: 'user-123',
        rawMessage: 'la subcategoría es Común',
        state,
        channel: 'telegram',
      }),
    ).resolves.toEqual({
      status: 'invalid_subcategory',
      parentCategory: 'Comida',
      attemptedSubcategory: 'Común',
      allowedSubcategories: ['Restaurante', 'Supermercado'],
    });
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it('returns an empty allowed-child list for an active parent without children', async () => {
    const interpretCorrection = vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
      intent: 'correction',
      changedFields: ['categoria', 'subcategoria'],
      monto: null,
      moneda: null,
      categoriaRaw: 'Otros',
      subcategoriaRaw: 'Varios',
      fechaRaw: null,
    });
    const classifier = vi.fn<ICategoryClassifier['execute']>().mockResolvedValue(
      HierarchicalClassificationResult.create(
        ClassificationSelection.confirmed('cat-other', 'Otros'),
      ),
    );
    const vocabulary = new CategoryVocabulary('sheet-1', [
      { id: 'cat-other', name: 'Otros', normalizedName: 'otros' },
    ]);
    const { useCase } = buildDeps({
      interpretCorrection,
      classifier,
      findCategoryVocabulary: vi
        .fn<ICategoryVocabularyRepository['findBySpreadsheetId']>()
        .mockResolvedValue(vocabulary),
    });
    const state = buildCorrectionState(
      buildReviewPayload({ resolvedCategoryId: 'cat-1', subcategoryEnabled: true }),
    );

    await expect(
      useCase.execute({
        userId: 'user-123',
        rawMessage: 'Otros, Varios',
        state,
        channel: 'telegram',
      }),
    ).resolves.toEqual({
      status: 'invalid_subcategory',
      parentCategory: 'Otros',
      attemptedSubcategory: 'Varios',
      allowedSubcategories: [],
    });
  });

  it('preserves a child on category-only correction only when its stable ID belongs to the parent', async () => {
    const interpretCorrection = vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
      intent: 'correction',
      changedFields: ['categoria'],
      monto: null,
      moneda: null,
      categoriaRaw: 'Comida',
      subcategoriaRaw: null,
      fechaRaw: null,
    });
    const classifier = vi.fn<ICategoryClassifier['execute']>().mockResolvedValue(
      HierarchicalClassificationResult.create(
        ClassificationSelection.confirmed('cat-1', 'Comida'),
      ),
    );
    const { useCase } = buildDeps({ interpretCorrection, classifier });
    const state = buildCorrectionState(
      buildReviewPayload({
        resolvedCategoryId: 'cat-1',
        resolvedSubcategory: 'Restaurante',
        resolvedSubcategoryId: 'sub-1',
        subcategoryStatus: 'confirmed',
        subcategoryEnabled: true,
        extracted: buildExtractedExpense({
          subcategoriaRaw: 'Restaurante',
          confianzaSubcategoria: 'alta',
        }),
      }),
    );

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'la categoría es Comida',
      state,
      channel: 'telegram',
    });

    expect(getPayload(result)).toEqual(
      expect.objectContaining({
        resolvedSubcategory: 'Restaurante',
        resolvedSubcategoryId: 'sub-1',
        subcategoryStatus: 'confirmed',
      }),
    );
    expect(getPayload(result).extracted.confianzaSubcategoria).toBe('alta');
  });

  it('clears a child to canonical no-child values when changing to another parent', async () => {
    const interpretCorrection = vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
      intent: 'correction',
      changedFields: ['categoria'],
      monto: null,
      moneda: null,
      categoriaRaw: 'Transporte',
      subcategoriaRaw: null,
      fechaRaw: null,
    });
    const classifier = vi.fn<ICategoryClassifier['execute']>().mockResolvedValue(
      HierarchicalClassificationResult.create(
        ClassificationSelection.confirmed('cat-2', 'Transporte'),
      ),
    );
    const { useCase } = buildDeps({ interpretCorrection, classifier });
    const state = buildCorrectionState(
      buildReviewPayload({
        resolvedCategoryId: 'cat-1',
        resolvedSubcategory: 'Restaurante',
        resolvedSubcategoryId: 'sub-1',
        subcategoryStatus: 'confirmed',
        subcategoryEnabled: true,
        extracted: buildExtractedExpense({
          subcategoriaRaw: 'Restaurante',
          confianzaSubcategoria: 'alta',
        }),
      }),
    );

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'la categoría es Transporte',
      state,
      channel: 'telegram',
    });

    expect(getPayload(result)).toEqual(
      expect.objectContaining({
        resolvedSubcategory: null,
        resolvedSubcategoryId: null,
        subcategoryStatus: 'none',
      }),
    );
    expect(getPayload(result).extracted).toEqual(
      expect.objectContaining({ subcategoriaRaw: null, confianzaSubcategoria: 'nula' }),
    );
  });

  it('requests explicit confirmation for unusually high corrected amounts', async () => {
    const { useCase, transitionMock, findAverageAmountByUserIdMock } = buildDeps({
      interpretCorrection: vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
        intent: 'correction',
        changedFields: ['monto'],
        monto: 1_000_000,
        moneda: null,
        categoriaRaw: null,
        subcategoriaRaw: null,
        fechaRaw: null,
      }),
      findAverageAmountByUserId: vi
        .fn<IExpenseRecordRepository['findAverageAmountByUserId']>()
        .mockResolvedValue(100),
    });
    const state = buildCorrectionState();

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'fueron un millón',
      state,
      channel: 'telegram',
    });

    expect(result.status).toBe('high_amount_confirmation');
    expect(getPayload(result).pendingHighAmountConfirmation).toBe(true);
    expect(findAverageAmountByUserIdMock).toHaveBeenCalledWith('user-123');
    expect(transitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        targetState: 'EXPENSE_REVIEW',
      }),
    );
    const transitionCall = transitionMock.mock.calls[0];
    expect((transitionCall?.[0] as { payload: Record<string, unknown> }).payload).toEqual(
      expect.objectContaining({ pendingHighAmountConfirmation: true }),
    );
  });

  it('returns cycle_limit when the correction exceeds the maximum cycles', async () => {
    const { useCase, transitionMock } = buildDeps();
    const state = buildCorrectionState(buildReviewPayload(), 5);

    const result = await useCase.execute({
      userId: 'user-123',
      rawMessage: 'no, fueron 15',
      state,
      channel: 'telegram',
    });

    expect(result.status).toBe('cycle_limit');
    expect(transitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        targetState: 'EXPENSE_CORRECTING',
      }),
    );
    const transitionCall = transitionMock.mock.calls[0];
    expect((transitionCall?.[0] as { payload: Record<string, unknown> }).payload).toEqual(
      expect.objectContaining({
        correctionCycles: 6,
      }),
    );
  });

  it('builds ordered hierarchy context and preserves the enabled capability', async () => {
    const { useCase, interpretCorrectionMock, findCategoryVocabularyMock } = buildDeps();
    const state = buildCorrectionState(buildReviewPayload({ subcategoryEnabled: true }));

    await useCase.execute({
      userId: 'user-123',
      rawMessage: 'no, fueron 15',
      state,
      channel: 'telegram',
    });

    expect(interpretCorrectionMock).toHaveBeenCalledWith(
      'no, fueron 15',
      state.payload.extracted,
      expect.objectContaining({
        defaultCurrency: 'EUR',
        categories: ['Comida', 'Transporte'],
        categoryHierarchy: [
          { name: 'Comida', subcategories: ['Restaurante', 'Supermercado'] },
          { name: 'Transporte', subcategories: ['Peajes'] },
        ],
        subcategoryEnabled: true,
        channel: 'telegram',
      }),
    );
    expect(findCategoryVocabularyMock).toHaveBeenCalledWith('sheet-1');
  });

  it('treats a legacy review payload as hierarchy-disabled while retaining context', async () => {
    const { useCase, interpretCorrectionMock } = buildDeps();
    const state = buildCorrectionState();

    await useCase.execute({
      userId: 'user-123',
      rawMessage: 'no, fueron 15',
      state,
      channel: 'telegram',
    });

    expect(interpretCorrectionMock).toHaveBeenCalledWith(
      expect.any(String),
      state.payload.extracted,
      expect.objectContaining({
        categoryHierarchy: [
          { name: 'Comida', subcategories: ['Restaurante', 'Supermercado'] },
          { name: 'Transporte', subcategories: ['Peajes'] },
        ],
        subcategoryEnabled: false,
      }),
    );
  });

  it('sets default currency to null when the current expense has none', async () => {
    const { useCase, interpretCorrectionMock } = buildDeps();
    const state = buildCorrectionState(
      buildReviewPayload({ extracted: buildExtractedExpense({ moneda: null }) }),
    );

    await useCase.execute({
      userId: 'user-123',
      rawMessage: 'no, fueron 15',
      state,
      channel: 'telegram',
    });

    expect(interpretCorrectionMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ defaultCurrency: null }),
    );
  });

  it('uses an empty category list when the user has no spreadsheet config', async () => {
    const { useCase, interpretCorrectionMock, findCategoryVocabularyMock } = buildDeps({
      findByUserId: vi.fn<ISpreadsheetConfigRepository['findByUserId']>().mockResolvedValue(null),
    });
    const state = buildCorrectionState();

    await useCase.execute({
      userId: 'user-123',
      rawMessage: 'no, fueron 15',
      state,
      channel: 'telegram',
    });

    expect(interpretCorrectionMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        categories: [],
        categoryHierarchy: [],
        subcategoryEnabled: false,
      }),
    );
    expect(findCategoryVocabularyMock).not.toHaveBeenCalled();
  });

  it('resets the review TTL on successful correction', async () => {
    const { useCase, transitionMock } = buildDeps();
    const state = buildCorrectionState();

    await useCase.execute({
      userId: 'user-123',
      rawMessage: 'no, fueron 15',
      state,
      channel: 'telegram',
    });

    const transitionCall = transitionMock.mock.calls[0];
    const expiresAt = (transitionCall?.[0] as { expiresAt: Date }).expiresAt;
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 1000);
  });
});

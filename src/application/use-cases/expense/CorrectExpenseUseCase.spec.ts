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
  IExpenseRecordRepository,
  ISpreadsheetConfigRepository,
  IUserCategoryRepository,
} from '../../../domain/ports/repositories';
import type { ICategoryClassifier } from '../../ports/in/categoryClassifier.port';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import { ClassificationResult } from '../../../domain/value-objects/ClassificationResult';

function buildExtractedExpense(overrides: Partial<ExtractedExpense> = {}): ExtractedExpense {
  return {
    monto: 12,
    moneda: 'EUR',
    categoriaRaw: 'Comida',
    fechaRaw: '2026-07-25',
    medioPago: null,
    confianzaCategoria: 'alta',
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
    findActiveBySpreadsheetId?: ReturnType<
      typeof vi.fn<IUserCategoryRepository['findActiveBySpreadsheetId']>
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
      fechaRaw: null,
    });

  const classifierMock: ReturnType<typeof vi.fn<ICategoryClassifier['execute']>> =
    overrides.classifier ??
    vi.fn<ICategoryClassifier['execute']>().mockResolvedValue(ClassificationResult.noMatch());

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

  const findActiveBySpreadsheetIdMock: ReturnType<
    typeof vi.fn<IUserCategoryRepository['findActiveBySpreadsheetId']>
  > =
    overrides.findActiveBySpreadsheetId ??
    vi.fn<IUserCategoryRepository['findActiveBySpreadsheetId']>().mockResolvedValue([
      {
        id: 'cat-1',
        spreadsheetId: 'sheet-1',
        rawValue: 'Comida',
        normalizedValue: 'Comida',
        usageCount: 1,
        isActive: true,
        createdAt: new Date(),
      },
      {
        id: 'cat-2',
        spreadsheetId: 'sheet-1',
        rawValue: 'Transporte',
        normalizedValue: 'Transporte',
        usageCount: 1,
        isActive: true,
        createdAt: new Date(),
      },
    ]);

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
  const categoryRepo = {
    findActiveBySpreadsheetId: findActiveBySpreadsheetIdMock,
  } as unknown as IUserCategoryRepository;
  const transitionState = { execute: transitionMock } as unknown as TransitionConversationState;

  return {
    useCase: new CorrectExpenseUseCase(
      {
        llm,
        classifier,
        expenseRepo,
        spreadsheetConfigRepo,
        categoryRepo,
        transitionState,
      },
      10,
    ),
    interpretCorrectionMock,
    classifierMock,
    findAverageAmountByUserIdMock,
    findByUserIdMock,
    findActiveBySpreadsheetIdMock,
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
        fechaRaw: null,
      }),
      classifier: vi
        .fn<ICategoryClassifier['execute']>()
        .mockResolvedValue(ClassificationResult.highConfidence('Transporte')),
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
        fechaRaw: null,
      }),
      classifier: vi
        .fn<ICategoryClassifier['execute']>()
        .mockResolvedValue(ClassificationResult.highConfidence('Transporte')),
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

  it('requests explicit confirmation for unusually high corrected amounts', async () => {
    const { useCase, transitionMock, findAverageAmountByUserIdMock } = buildDeps({
      interpretCorrection: vi.fn<LLMPort['interpretCorrection']>().mockResolvedValue({
        intent: 'correction',
        changedFields: ['monto'],
        monto: 1_000_000,
        moneda: null,
        categoriaRaw: null,
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

  it('builds the user context from the spreadsheet config', async () => {
    const { useCase, interpretCorrectionMock } = buildDeps();
    const state = buildCorrectionState();

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
        channel: 'telegram',
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
    const { useCase, interpretCorrectionMock } = buildDeps({
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
      expect.objectContaining({ categories: [] }),
    );
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

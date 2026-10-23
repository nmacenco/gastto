// LAYER: Application / Tests
// Unit tests for GenerateExpenseSummaryUseCase.
// The use case maps the review payload into a channel-agnostic DTO and
// delegates presentation to the injected presenter. The expense repository
// is mocked so the high-amount detection is tested in isolation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerateExpenseSummaryUseCase } from './GenerateExpenseSummaryUseCase';
import type { ExpenseSummaryPresenter } from '../../ports/output/expense-summary.presenter';
import type { ExpenseSummary } from '../../dtos/expense-summary.dto';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import type { IExpenseRecordRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { ConversationState } from '../../../domain/entities/ConversationState';

const mockFindAverageAmountByUserId = vi.fn();

function buildMockExpenseRepo(): IExpenseRecordRepository {
  return {
    create: vi.fn(),
    findLatestByUserId: vi.fn(),
    findRecentCurrenciesByUserId: vi.fn(),
    findAverageAmountByUserId: mockFindAverageAmountByUserId,
    softDelete: vi.fn(),
    softDeleteWithAudit: vi.fn(),
  };
}

function buildMockPresenter(): ExpenseSummaryPresenter & {
  presentSummary: ReturnType<typeof vi.fn>;
  showTimeoutWarning: ReturnType<typeof vi.fn>;
  notifyCancellation: ReturnType<typeof vi.fn>;
  requestHighAmountConfirmation: ReturnType<typeof vi.fn>;
} {
  return {
    presentSummary: vi.fn(),
    showTimeoutWarning: vi.fn(),
    notifyCancellation: vi.fn(),
    requestHighAmountConfirmation: vi.fn(),
  };
}

function buildExtractedExpense(overrides: Partial<ExtractedExpense> = {}): ExtractedExpense {
  return {
    monto: 100,
    moneda: 'EUR',
    categoriaRaw: 'café',
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
    rawMessage: 'Café con leche 100 EUR',
    resolvedDate: '2026-07-25',
    resolvedCategory: 'Comida',
    resolvedCategoryId: null,
    categoryStatus: 'confirmed',
    resolvedSubcategory: null,
    resolvedSubcategoryId: null,
    subcategoryStatus: 'none',
    subcategoryEnabled: false,
    ...overrides,
  };
}

function buildUseCase(multiplier = 10) {
  return {
    useCase: new GenerateExpenseSummaryUseCase(buildMockExpenseRepo(), multiplier),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindAverageAmountByUserId.mockResolvedValue(null);
});

describe('GenerateExpenseSummaryUseCase', () => {
  it('presents a summary with all five fields', async () => {
    const presenter = buildMockPresenter();
    const { useCase } = buildUseCase();
    const payload = buildReviewPayload();

    await useCase.execute({ userId: 'user-123', payload, presenter });

    expect(mockFindAverageAmountByUserId).toHaveBeenCalledWith('user-123');
    expect(presenter.presentSummary).toHaveBeenCalledTimes(1);
    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.concept).toBe('Café con leche 100 EUR');
    expect(summary.amount).toBe(100);
    expect(summary.currency).toBe('EUR');
    expect(summary.category).toBe('Comida');
    expect(summary.date).toBe('2026-07-25');
    expect(summary.categoryConfidence).toBe('alta');
    expect(summary.categoryStatus).toBe('confirmed');
    expect(summary.subcategory).toBe('');
    expect(summary.subcategoryConfidence).toBe('nula');
    expect(summary.subcategoryStatus).toBe('none');
    expect(summary.subcategoryEnabled).toBe(false);
    expect(summary.actions).toEqual({ confirm: true, correct: true, cancel: true });
    expect(summary.isHighAmount).toBe(false);
    expect(summary.requiresExplicitConfirmation).toBe(false);
  });

  it('defaults the date to "today" when the input has no date', async () => {
    const presenter = buildMockPresenter();
    const { useCase } = buildUseCase();
    const payload = buildReviewPayload({
      extracted: buildExtractedExpense({ fechaRaw: null }),
      resolvedDate: '2026-07-30',
    });

    await useCase.execute({ userId: 'user-123', payload, presenter });

    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.date).toBe('today');
  });

  it('preserves the resolved date when the input has a date', async () => {
    const presenter = buildMockPresenter();
    const { useCase } = buildUseCase();
    const payload = buildReviewPayload({
      extracted: buildExtractedExpense({ fechaRaw: '2026-07-20' }),
      resolvedDate: '2026-07-20',
    });

    await useCase.execute({ userId: 'user-123', payload, presenter });

    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.date).toBe('2026-07-20');
  });

  it('flags low-confidence categories through the payload values', async () => {
    const presenter = buildMockPresenter();
    const { useCase } = buildUseCase();
    const payload = buildReviewPayload({
      extracted: buildExtractedExpense({ confianzaCategoria: 'baja' }),
      categoryStatus: 'ambiguous',
    });

    await useCase.execute({ userId: 'user-123', payload, presenter });

    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.categoryConfidence).toBe('baja');
    expect(summary.categoryStatus).toBe('ambiguous');
  });

  it('uses an empty category label when the category is unresolved', async () => {
    const presenter = buildMockPresenter();
    const { useCase } = buildUseCase();
    const payload = buildReviewPayload({
      resolvedCategory: null,
      categoryStatus: 'none',
    });

    await useCase.execute({ userId: 'user-123', payload, presenter });

    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.category).toBe('');
    expect(summary.categoryStatus).toBe('none');
  });

  it('includes a selected subcategory and its independent confidence when enabled', async () => {
    const presenter = buildMockPresenter();
    const { useCase } = buildUseCase();
    const payload = buildReviewPayload({
      extracted: buildExtractedExpense({
        confianzaCategoria: 'baja',
        confianzaSubcategoria: 'alta',
      }),
      resolvedSubcategory: 'Restaurante',
      resolvedSubcategoryId: 'subcategory-1',
      subcategoryStatus: 'confirmed',
      subcategoryEnabled: true,
    });

    await useCase.execute({ userId: 'user-123', payload, presenter });

    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.categoryConfidence).toBe('baja');
    expect(summary.subcategory).toBe('Restaurante');
    expect(summary.subcategoryConfidence).toBe('alta');
    expect(summary.subcategoryStatus).toBe('confirmed');
    expect(summary.subcategoryEnabled).toBe(true);
  });

  it.each([
    { status: 'ambiguous' as const, confidence: 'baja' as const },
    { status: 'fallback' as const, confidence: 'nula' as const },
  ])('preserves a $status subcategory selection', async ({ status, confidence }) => {
    const presenter = buildMockPresenter();
    const { useCase } = buildUseCase();
    const payload = buildReviewPayload({
      extracted: buildExtractedExpense({ confianzaSubcategoria: confidence }),
      resolvedSubcategory: 'Restaurante',
      subcategoryStatus: status,
      subcategoryEnabled: true,
    });

    await useCase.execute({ userId: 'user-123', payload, presenter });

    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.subcategory).toBe('Restaurante');
    expect(summary.subcategoryConfidence).toBe(confidence);
    expect(summary.subcategoryStatus).toBe(status);
  });

  it('shows an empty child selection when hierarchy support is enabled without a match', async () => {
    const presenter = buildMockPresenter();
    const { useCase } = buildUseCase();
    const payload = buildReviewPayload({ subcategoryEnabled: true });

    await useCase.execute({ userId: 'user-123', payload, presenter });

    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.subcategory).toBe('');
    expect(summary.subcategoryStatus).toBe('none');
    expect(summary.subcategoryEnabled).toBe(true);
  });

  it('normalizes legacy missing hierarchy fields as a disabled empty subcategory', async () => {
    const presenter = buildMockPresenter();
    const { useCase } = buildUseCase();
    const payload = buildReviewPayload();
    delete payload.resolvedSubcategory;
    delete payload.resolvedSubcategoryId;
    delete payload.subcategoryStatus;
    delete payload.subcategoryEnabled;
    delete (payload.extracted as Partial<ExtractedExpense>).subcategoriaRaw;
    delete (payload.extracted as Partial<ExtractedExpense>).confianzaSubcategoria;

    await useCase.execute({ userId: 'user-123', payload, presenter });

    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.subcategory).toBe('');
    expect(summary.subcategoryConfidence).toBe('nula');
    expect(summary.subcategoryStatus).toBe('none');
    expect(summary.subcategoryEnabled).toBe(false);
  });

  it('marks the amount as high when it exceeds the configured multiplier of the average', async () => {
    const presenter = buildMockPresenter();
    mockFindAverageAmountByUserId.mockResolvedValue(100);
    const { useCase } = buildUseCase(10);
    const payload = buildReviewPayload({
      extracted: buildExtractedExpense({ monto: 1001 }),
    });

    await useCase.execute({ userId: 'user-123', payload, presenter });

    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.isHighAmount).toBe(true);
    expect(summary.requiresExplicitConfirmation).toBe(true);
  });

  it('does not mark the amount as high when it is within the threshold', async () => {
    const presenter = buildMockPresenter();
    mockFindAverageAmountByUserId.mockResolvedValue(100);
    const { useCase } = buildUseCase(10);
    const payload = buildReviewPayload({
      extracted: buildExtractedExpense({ monto: 1000 }),
    });

    await useCase.execute({ userId: 'user-123', payload, presenter });

    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.isHighAmount).toBe(false);
    expect(summary.requiresExplicitConfirmation).toBe(false);
  });

  it('does not warn when there is no historical average', async () => {
    const presenter = buildMockPresenter();
    mockFindAverageAmountByUserId.mockResolvedValue(null);
    const { useCase } = buildUseCase(10);
    const payload = buildReviewPayload({
      extracted: buildExtractedExpense({ monto: 100000 }),
    });

    await useCase.execute({ userId: 'user-123', payload, presenter });

    const summary = presenter.presentSummary.mock.calls[0]![0] as ExpenseSummary;
    expect(summary.isHighAmount).toBe(false);
    expect(summary.requiresExplicitConfirmation).toBe(false);
  });
});

describe('GenerateExpenseSummaryUseCase presentation binding', () => {
  function buildBoundUseCase(payload: ExpenseReviewPayload) {
    let state: ConversationState = {
      userId: 'user-123',
      revision: '1',
      currentState: 'EXPENSE_REVIEW' as const,
      statePayload: payload as unknown as Record<string, unknown>,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      enteredAt: new Date(),
      updatedAt: new Date(),
    };
    const execute = vi.fn((input: Parameters<TransitionConversationState['execute']>[0]) => {
      state = {
        ...state,
        revision: String(Number(state.revision) + 1),
        statePayload: input.payload ?? null,
        expiresAt: input.expiresAt ?? null,
      };
      return Promise.resolve({ status: 'updated' as const, state });
    });
    const transitionState = {
      currentState: () => state,
      execute,
    } as unknown as TransitionConversationState;
    return {
      useCase: new GenerateExpenseSummaryUseCase(buildMockExpenseRepo(), transitionState),
      execute,
      currentState: () => state,
    };
  }

  it('upgrades and persists a legacy binding before rendering, then marks successful delivery', async () => {
    const payload = buildReviewPayload();
    const presenter = buildMockPresenter();
    const { useCase, execute, currentState } = buildBoundUseCase(payload);

    await useCase.execute({ userId: 'user-123', payload, presenter });

    expect(execute).toHaveBeenCalledTimes(2);
    const firstPayload = execute.mock.calls[0]?.[0].payload as unknown as ExpenseReviewPayload;
    expect(firstPayload.reviewBinding).toMatchObject({ revision: 1, presentedAt: null });
    expect(presenter.presentSummary).toHaveBeenCalledWith(
      expect.any(Object),
      firstPayload.reviewBinding,
    );
    expect(
      (currentState().statePayload as unknown as ExpenseReviewPayload).reviewBinding?.presentedAt,
    ).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('leaves authorization unavailable when presentation fails', async () => {
    const payload = buildReviewPayload();
    const presenter = buildMockPresenter();
    presenter.presentSummary.mockRejectedValue(new Error('delivery uncertain'));
    const { useCase, execute, currentState } = buildBoundUseCase(payload);

    await expect(useCase.execute({ userId: 'user-123', payload, presenter })).rejects.toThrow(
      'delivery uncertain',
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(
      (currentState().statePayload as unknown as ExpenseReviewPayload).reviewBinding?.presentedAt,
    ).toBeNull();
  });
});

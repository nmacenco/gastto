// LAYER: Application / Tests
// Unit tests for GenerateExpenseSummaryUseCase.
// The use case maps the review payload into a channel-agnostic DTO and
// delegates presentation to the injected presenter. The expense repository
// is mocked so the high-amount detection is tested in isolation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerateExpenseSummaryUseCase } from './GenerateExpenseSummaryUseCase';
import type { ExpenseSummaryPresenter } from '../../ports/output/expense-summary.presenter';
import type { ExpenseSummary } from '../../dtos/expense-summary.dto';
import type { ExpenseReviewPayload } from './RegisterExpense';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import type { IExpenseRecordRepository } from '../../../domain/ports/repositories';

const mockFindAverageAmountByUserId = vi.fn();

function buildMockExpenseRepo(): IExpenseRecordRepository {
  return {
    create: vi.fn(),
    findLatestByUserId: vi.fn(),
    findRecentCurrenciesByUserId: vi.fn(),
    findAverageAmountByUserId: mockFindAverageAmountByUserId,
    softDelete: vi.fn(),
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
    fechaRaw: '2026-07-25',
    medioPago: null,
    confianzaCategoria: 'alta',
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

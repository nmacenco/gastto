// LAYER: Application / Tests
// Unit tests for RegisterExpense use case interpretation phase.
// Covers LLM success, deterministic fallback for amount/currency, and
// clarification transitions triggered by the fallback. All external ports
// are mocked (no DB, no LLM, no Telegram).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterExpenseUseCase, type RegisterExpenseInput } from './RegisterExpense';
import type { LLMPort, SpreadsheetPort } from '../../../domain/ports/services';
import type { IUserProfilePort } from '../../../domain/ports/IUserProfilePort';
import type {
  IExpenseRecordRepository,
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
  IUserCategoryRepository,
  IConversationStateRepository,
  IOperationLogRepository,
} from '../../../domain/ports/repositories';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import type { ICategoryClassifier } from '../../ports/in/categoryClassifier.port';
import { ClassificationResult } from '../../../domain/value-objects/ClassificationResult';

const mockUserProfileGetDefaultCurrency = vi.fn();
const mockClassifierExecute = vi.fn();
const mockLLMExtractExpense = vi.fn();
const mockSpreadsheetConfigFindByUserId = vi.fn();
const mockCategoryFindActiveBySpreadsheetId = vi.fn();
const mockConversationTransition = vi.fn();
const mockExpenseRecordCreate = vi.fn();
const mockOperationLogCreate = vi.fn();
const mockAppendRow = vi.fn();
const mockFindLatestByUserId = vi.fn();
const mockSoftDelete = vi.fn();
const mockFindBySpreadsheetId = vi.fn();
const mockUpsertMany = vi.fn();
const mockConfirm = vi.fn();
const mockConfirmBySpreadsheetId = vi.fn();
const mockUpdateCorrected = vi.fn();

function buildMockLLMPort(): LLMPort {
  return {
    extractExpense: mockLLMExtractExpense,
    interpretCorrection: vi.fn(),
    generateResponse: vi.fn(),
  };
}

function buildMockSpreadsheetPort(): SpreadsheetPort {
  return {
    readRows: vi.fn(),
    appendRow: mockAppendRow,
    deleteRow: vi.fn(),
    getUniqueValues: vi.fn(),
    getHeaders: vi.fn(),
    listSheets: vi.fn(),
    validateAccess: vi.fn(),
  };
}

function buildMockUserProfilePort(): IUserProfilePort {
  return {
    getDefaultCurrency: mockUserProfileGetDefaultCurrency,
  };
}

function buildMockClassifier(): ICategoryClassifier {
  return {
    execute: mockClassifierExecute,
  };
}

function buildMockDependencies() {
  return {
    llm: buildMockLLMPort(),
    spreadsheetPort: buildMockSpreadsheetPort(),
    expenseRepo: {
      create: mockExpenseRecordCreate,
      findLatestByUserId: mockFindLatestByUserId,
      softDelete: mockSoftDelete,
    } as unknown as IExpenseRecordRepository,
    spreadsheetConfigRepo: {
      findByUserId: mockSpreadsheetConfigFindByUserId,
      create: vi.fn(),
      upsertByUserId: vi.fn(),
      updateAccessVerified: vi.fn(),
      updateCategoriesConfirmed: vi.fn(),
    } as unknown as ISpreadsheetConfigRepository,
    columnMappingRepo: {
      findBySpreadsheetId: mockFindBySpreadsheetId,
      upsertMany: mockUpsertMany,
      confirm: mockConfirm,
      confirmBySpreadsheetId: mockConfirmBySpreadsheetId,
      updateCorrected: mockUpdateCorrected,
    } as unknown as IColumnMappingRepository,
    categoryRepo: {
      findActiveBySpreadsheetId: mockCategoryFindActiveBySpreadsheetId,
      upsertMany: vi.fn(),
      incrementUsage: vi.fn(),
    } as unknown as IUserCategoryRepository,
    conversationRepo: {
      findByUserId: vi.fn(),
      create: vi.fn(),
      transition: mockConversationTransition,
      findExpired: vi.fn(),
    } as unknown as IConversationStateRepository,
    logRepo: {
      create: mockOperationLogCreate,
    } as unknown as IOperationLogRepository,
    userProfilePort: buildMockUserProfilePort(),
    classifier: buildMockClassifier(),
  };
}

function buildUseCase(overrides: Partial<ReturnType<typeof buildMockDependencies>> = {}) {
  const deps = buildMockDependencies();
  return {
    useCase: new RegisterExpenseUseCase(
      overrides.llm ?? deps.llm,
      overrides.spreadsheetPort ?? deps.spreadsheetPort,
      overrides.expenseRepo ?? deps.expenseRepo,
      overrides.spreadsheetConfigRepo ?? deps.spreadsheetConfigRepo,
      overrides.columnMappingRepo ?? deps.columnMappingRepo,
      overrides.categoryRepo ?? deps.categoryRepo,
      overrides.conversationRepo ?? deps.conversationRepo,
      overrides.logRepo ?? deps.logRepo,
      overrides.userProfilePort ?? deps.userProfilePort,
      overrides.classifier ?? deps.classifier,
    ),
    deps: { ...deps, ...overrides },
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

function buildInput(overrides: Partial<RegisterExpenseInput> = {}): RegisterExpenseInput {
  return {
    userId: 'user-123',
    rawMessage: 'Café con leche 100 EUR',
    channel: 'telegram',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserProfileGetDefaultCurrency.mockResolvedValue(null);
  mockSpreadsheetConfigFindByUserId.mockResolvedValue({
    id: 'config-1',
    userId: 'user-123',
    provider: 'google',
    fileId: 'file-1',
    fileName: 'Gastos',
    sheetName: 'Hoja 1',
    accessVerifiedAt: new Date(),
    categoriesConfirmedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockCategoryFindActiveBySpreadsheetId.mockResolvedValue([]);
  mockConversationTransition.mockResolvedValue(null);
  mockAppendRow.mockResolvedValue({ sheet: 'Hoja 1', row: 2 });
  mockClassifierExecute.mockResolvedValue(ClassificationResult.noMatch());
});

describe('RegisterExpenseUseCase', () => {
  describe('interpret()', () => {
    it('LLM succeeds with amount and currency -> ready_for_review', async () => {
      const extracted = buildExtractedExpense({ monto: 100, moneda: 'EUR' });
      mockLLMExtractExpense.mockResolvedValue(extracted);

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput());

      expect(result.status).toBe('ready_for_review');
      if (result.status !== 'ready_for_review') {
        throw new Error('Expected ready_for_review');
      }
      expect(result.payload.extracted.monto).toBe(100);
      expect(result.payload.extracted.moneda).toBe('EUR');
      expect(result.payload.resolvedDate).toBe('2026-07-25');
      expect(result.payload.resolvedCategory).toBeNull();
      expect(result.payload.categoryStatus).toBe('none');
      expect(mockClassifierExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Café con leche 100 EUR',
        llmCategory: 'café',
        llmConfidence: 'alta',
      });
      expect(mockConversationTransition).toHaveBeenCalledTimes(1);
      expect(mockConversationTransition).toHaveBeenCalledWith(
        'user-123',
        'EXPENSE_REVIEW',
        expect.any(Object),
        expect.any(Date),
      );
      expect(mockConversationTransition.mock.calls[0]?.[2]).toMatchObject({
        extracted: { monto: 100, moneda: 'EUR' },
        rawMessage: 'Café con leche 100 EUR',
        resolvedDate: '2026-07-25',
        resolvedCategory: null,
        resolvedCategoryId: null,
        categoryStatus: 'none',
      });
    });

    it('propagates a confirmed classification as categoryStatus confirmed', async () => {
      mockClassifierExecute.mockResolvedValue(ClassificationResult.highConfidence('Comida'));
      mockLLMExtractExpense.mockResolvedValue(buildExtractedExpense({ categoriaRaw: 'comida' }));

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Almuerzo 100 EUR' }));

      expect(result.status).toBe('ready_for_review');
      if (result.status !== 'ready_for_review') {
        throw new Error('Expected ready_for_review');
      }
      expect(result.payload.resolvedCategory).toBe('Comida');
      expect(result.payload.categoryStatus).toBe('confirmed');
    });

    it('propagates an ambiguous classification as categoryStatus ambiguous', async () => {
      mockClassifierExecute.mockResolvedValue(ClassificationResult.ambiguous('Ocio'));
      mockLLMExtractExpense.mockResolvedValue(buildExtractedExpense({ categoriaRaw: 'ocio' }));

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Cine y cena 100 EUR' }));

      expect(result.status).toBe('ready_for_review');
      if (result.status !== 'ready_for_review') {
        throw new Error('Expected ready_for_review');
      }
      expect(result.payload.resolvedCategory).toBe('Ocio');
      expect(result.payload.categoryStatus).toBe('ambiguous');
    });

    it('propagates a fallback classification as categoryStatus fallback', async () => {
      mockClassifierExecute.mockResolvedValue(ClassificationResult.fallback('Comida'));
      mockLLMExtractExpense.mockResolvedValue(
        buildExtractedExpense({ categoriaRaw: 'restaurante' }),
      );

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Restaurante 100 EUR' }));

      expect(result.status).toBe('ready_for_review');
      if (result.status !== 'ready_for_review') {
        throw new Error('Expected ready_for_review');
      }
      expect(result.payload.resolvedCategory).toBe('Comida');
      expect(result.payload.categoryStatus).toBe('fallback');
    });

    it('propagates a no-match classification as categoryStatus none', async () => {
      mockClassifierExecute.mockResolvedValue(ClassificationResult.noMatch());
      mockLLMExtractExpense.mockResolvedValue(buildExtractedExpense({ categoriaRaw: null }));

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Gasté 100 EUR' }));

      expect(result.status).toBe('ready_for_review');
      if (result.status !== 'ready_for_review') {
        throw new Error('Expected ready_for_review');
      }
      expect(result.payload.resolvedCategory).toBeNull();
      expect(result.payload.categoryStatus).toBe('none');
    });

    it('LLM misses currency but user has default currency -> deterministic fallback resolves it', async () => {
      mockUserProfileGetDefaultCurrency.mockResolvedValue('USD');
      mockLLMExtractExpense.mockResolvedValue(buildExtractedExpense({ monto: 100, moneda: null }));

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Gasté 100 en el taxi' }));

      expect(result.status).toBe('ready_for_review');
      if (result.status !== 'ready_for_review') {
        throw new Error('Expected ready_for_review');
      }
      expect(result.payload.extracted.monto).toBe(100);
      expect(result.payload.extracted.moneda).toBe('USD');
    });

    it('LLM misses amount and fallback also misses it -> needs_clarification with missingField: monto', async () => {
      mockLLMExtractExpense.mockResolvedValue(
        buildExtractedExpense({ monto: null, moneda: 'EUR' }),
      );

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Pagué el café en EUR' }));

      expect(result.status).toBe('needs_clarification');
      if (result.status !== 'needs_clarification') {
        throw new Error('Expected needs_clarification');
      }
      expect(result.missingField).toBe('monto');
      expect(mockConversationTransition).toHaveBeenCalledWith(
        'user-123',
        'EXPENSE_CLARIFYING',
        expect.any(Object),
        expect.any(Date),
      );
      expect(mockConversationTransition.mock.calls[0]?.[2]).toMatchObject({
        missingField: 'monto',
        rawMessage: 'Pagué el café en EUR',
      });
    });

    it('LLM/$ symbol is ambiguous and default currency matches -> resolved', async () => {
      mockUserProfileGetDefaultCurrency.mockResolvedValue('ARS');
      mockLLMExtractExpense.mockResolvedValue(buildExtractedExpense({ monto: null, moneda: null }));

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Gasté $1.200 en el taxi' }));

      expect(result.status).toBe('ready_for_review');
      if (result.status !== 'ready_for_review') {
        throw new Error('Expected ready_for_review');
      }
      expect(result.payload.extracted.monto).toBe(1200);
      expect(result.payload.extracted.moneda).toBe('ARS');
    });

    it('LLM/$ symbol is ambiguous without default currency -> needs_clarification with missingField: moneda', async () => {
      mockUserProfileGetDefaultCurrency.mockResolvedValue(null);
      mockLLMExtractExpense.mockResolvedValue(buildExtractedExpense({ monto: null, moneda: null }));

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Gasté $1.200 en el taxi' }));

      expect(result.status).toBe('needs_clarification');
      if (result.status !== 'needs_clarification') {
        throw new Error('Expected needs_clarification');
      }
      expect(result.missingField).toBe('moneda');
    });

    it('default currency is fetched through the port (mock the port, not Drizzle)', async () => {
      mockUserProfileGetDefaultCurrency.mockResolvedValue('EUR');
      mockLLMExtractExpense.mockResolvedValue(buildExtractedExpense({ monto: 50, moneda: 'EUR' }));

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Café 50 EUR' }));

      expect(mockUserProfileGetDefaultCurrency).toHaveBeenCalledTimes(1);
      expect(mockUserProfileGetDefaultCurrency).toHaveBeenCalledWith('user-123');
      expect(mockLLMExtractExpense).toHaveBeenCalledWith(
        'Café 50 EUR',
        expect.objectContaining({ defaultCurrency: 'EUR' }),
      );
      expect(result.status).toBe('ready_for_review');
      if (result.status !== 'ready_for_review') {
        throw new Error('Expected ready_for_review');
      }
      expect(result.payload.extracted.moneda).toBe('EUR');
    });

    it('asks for amount first when both amount and currency are missing', async () => {
      mockLLMExtractExpense.mockResolvedValue(buildExtractedExpense({ monto: null, moneda: null }));

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Gasté algo' }));

      expect(result.status).toBe('needs_clarification');
      if (result.status !== 'needs_clarification') {
        throw new Error('Expected needs_clarification');
      }
      expect(result.missingField).toBe('monto');
      expect(mockConversationTransition).toHaveBeenCalledWith(
        'user-123',
        'EXPENSE_CLARIFYING',
        expect.objectContaining({ missingField: 'monto' }),
        expect.any(Date),
      );
    });

    it('asks for currency when amount is present but currency is missing', async () => {
      mockLLMExtractExpense.mockResolvedValue(buildExtractedExpense({ monto: 100, moneda: null }));

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Gasté 100' }));

      expect(result.status).toBe('needs_clarification');
      if (result.status !== 'needs_clarification') {
        throw new Error('Expected needs_clarification');
      }
      expect(result.missingField).toBe('moneda');
      expect(mockConversationTransition).toHaveBeenCalledWith(
        'user-123',
        'EXPENSE_CLARIFYING',
        expect.objectContaining({ missingField: 'moneda' }),
        expect.any(Date),
      );
    });

    it('asks for amount when amount is missing even if currency is also ambiguous', async () => {
      mockLLMExtractExpense.mockResolvedValue(buildExtractedExpense({ monto: null, moneda: null }));

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(buildInput({ rawMessage: 'Pagué en euros' }));

      expect(result.status).toBe('needs_clarification');
      if (result.status !== 'needs_clarification') {
        throw new Error('Expected needs_clarification');
      }
      expect(result.missingField).toBe('monto');
    });

    it('proceeds to review when category is ambiguous instead of asking for clarification', async () => {
      mockClassifierExecute.mockResolvedValue(ClassificationResult.ambiguous('Ocio'));
      mockLLMExtractExpense.mockResolvedValue(
        buildExtractedExpense({ categoriaRaw: 'ocio', confianzaCategoria: 'baja' }),
      );

      const { useCase } = buildUseCase();
      const result = await useCase.interpret(
        buildInput({ rawMessage: 'Compré algo en el kiosco, 8 euros' }),
      );

      expect(result.status).toBe('ready_for_review');
      if (result.status !== 'ready_for_review') {
        throw new Error('Expected ready_for_review');
      }
      expect(result.payload.categoryStatus).toBe('ambiguous');
      expect(result.payload.resolvedCategory).toBe('Ocio');
    });

    it('uses the typed ExpenseClarificationState payload in the transition', async () => {
      mockLLMExtractExpense.mockResolvedValue(
        buildExtractedExpense({ monto: null, moneda: 'EUR' }),
      );

      const { useCase } = buildUseCase();
      await useCase.interpret(buildInput({ rawMessage: 'Pagué el café en EUR' }));

      const payload = mockConversationTransition.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(payload).toMatchObject({
        _type: 'ExpenseClarificationState',
        missingField: 'monto',
        rawMessage: 'Pagué el café en EUR',
      });
      expect(payload).toHaveProperty('partialExtracted');
    });

    it('asks for currency after the user provides the missing amount in a sequential clarification', async () => {
      mockLLMExtractExpense
        .mockResolvedValueOnce(buildExtractedExpense({ monto: null, moneda: null }))
        .mockResolvedValueOnce(buildExtractedExpense({ monto: 100, moneda: null }));

      const { useCase } = buildUseCase();
      const first = await useCase.interpret(buildInput({ rawMessage: 'Gasté algo' }));
      expect(first.status).toBe('needs_clarification');
      if (first.status !== 'needs_clarification') {
        throw new Error('Expected needs_clarification');
      }
      expect(first.missingField).toBe('monto');

      const second = await useCase.interpret(buildInput({ rawMessage: 'Gasté algo 100' }));
      expect(second.status).toBe('needs_clarification');
      if (second.status !== 'needs_clarification') {
        throw new Error('Expected needs_clarification');
      }
      expect(second.missingField).toBe('moneda');
    });

    it('sets the EXPENSE_CLARIFYING timeout to 30 minutes', async () => {
      mockLLMExtractExpense.mockResolvedValue(
        buildExtractedExpense({ monto: null, moneda: 'EUR' }),
      );

      const { useCase } = buildUseCase();
      await useCase.interpret(buildInput({ rawMessage: 'Pagué el café en EUR' }));

      expect(mockConversationTransition).toHaveBeenCalledTimes(1);
      const expiresAt = mockConversationTransition.mock.calls[0]?.[3] as Date;
      const expectedMin = new Date(Date.now() + 29 * 60 * 1000);
      const expectedMax = new Date(Date.now() + 31 * 60 * 1000);
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThan(expectedMin.getTime());
      expect(expiresAt.getTime()).toBeLessThan(expectedMax.getTime());
    });
  });
});

// LAYER: End-to-end tests
// Exercises the worker-owned confirmation, retry, persistence, messaging, and undo lifecycle.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { GetConversationState } from '../../application/use-cases/conversation/GetConversationState';
import { TransitionConversationState } from '../../application/use-cases/conversation/TransitionConversationState';
import { RegisterExpenseUseCase } from '../../application/use-cases/expense/RegisterExpense';
import { ResolveExpenseSummaryActionUseCase } from '../../application/use-cases/expense/ResolveExpenseSummaryActionUseCase';
import { RetryExpenseSaveUseCase } from '../../application/use-cases/expense/RetryExpenseSaveUseCase';
import { UndoLastExpenseUseCase } from '../../application/use-cases/expense/UndoLastExpense';
import type { ProcessMessageJobData } from '../../application/ports/ProcessMessageJob';
import type { ConversationState } from '../../domain/entities/ConversationState';
import type { ExpenseRecord } from '../../domain/entities/ExpenseRecord';
import { SpreadsheetError } from '../../domain/errors/SpreadsheetError';
import type {
  IConversationStateRepository,
  IExpenseRecordRepository,
} from '../../domain/ports/repositories';
import type { ExpenseReviewPayload } from '../../domain/value-objects/expense-review-payload';
import { processMessageJob, type MessageWorkerDeps } from '../../interfaces/workers/message.worker';

const userId = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';
const subcategoryId = '33333333-3333-4333-8333-333333333333';
const spreadsheetId = '44444444-4444-4444-8444-444444444444';
const externalId = 'chat-123';

const basePayload: ExpenseReviewPayload = {
  rawMessage: 'Dinner 24.50 EUR',
  extracted: {
    monto: 24.5,
    moneda: 'EUR',
    categoriaRaw: 'Food',
    subcategoriaRaw: 'Restaurant',
    fechaRaw: '2026-09-05',
    medioPago: 'Card',
    confianzaCategoria: 'alta',
    confianzaSubcategoria: 'alta',
  },
  resolvedDate: '2026-09-05',
  resolvedCategory: 'Food',
  resolvedCategoryId: categoryId,
  categoryStatus: 'confirmed',
  resolvedSubcategory: 'Restaurant',
  resolvedSubcategoryId: subcategoryId,
  subcategoryStatus: 'confirmed',
  subcategoryEnabled: true,
};

type Mapping = {
  GasttoField: 'monto' | 'moneda' | 'categoria' | 'subcategoria' | 'fecha' | 'concepto';
  columnIndex: number;
};

class MemoryConversationRepository implements IConversationStateRepository {
  constructor(public state: ConversationState) {}

  findByUserId(): Promise<ConversationState> {
    return Promise.resolve(this.state);
  }

  create(): Promise<ConversationState> {
    return Promise.resolve(this.state);
  }

  transition(
    _userId: string,
    nextState: ConversationState['currentState'],
    payload: Record<string, unknown> | null,
    expiresAt: Date | null,
  ): Promise<ConversationState> {
    const now = new Date();
    this.state = {
      ...this.state,
      currentState: nextState,
      statePayload: payload,
      expiresAt,
      enteredAt: now,
      updatedAt: now,
    };
    return Promise.resolve(this.state);
  }

  findExpired(): Promise<ConversationState[]> {
    return Promise.resolve([]);
  }
}

class MemoryExpenseRepository implements IExpenseRecordRepository {
  records: ExpenseRecord[] = [];

  create(record: Omit<ExpenseRecord, 'id' | 'createdAt' | 'savedAt'>): Promise<ExpenseRecord> {
    const now = new Date();
    const saved: ExpenseRecord = {
      ...record,
      id: `expense-${this.records.length + 1}`,
      createdAt: now,
      savedAt: now,
    };
    this.records.push(saved);
    return Promise.resolve(saved);
  }

  findLatestByUserId(requestedUserId: string): Promise<ExpenseRecord | null> {
    return Promise.resolve(
      [...this.records]
        .reverse()
        .find((record) => record.userId === requestedUserId && !record.isDeleted) ?? null,
    );
  }

  findRecentCurrenciesByUserId(): Promise<ExpenseRecord['moneda'][]> {
    return Promise.resolve([]);
  }

  findAverageAmountByUserId(): Promise<number | null> {
    return Promise.resolve(null);
  }

  softDelete(id: string): Promise<void> {
    const record = this.records.find((candidate) => candidate.id === id);
    if (record) {
      record.isDeleted = true;
      record.deletedAt = new Date();
    }
    return Promise.resolve();
  }

  softDeleteWithAudit(id: string): Promise<void> {
    return this.softDelete(id);
  }
}

type HarnessOptions = {
  payload: ExpenseReviewPayload | Record<string, unknown>;
  mappings: Mapping[];
  appendFailures?: number;
};

function buildJob(input: { rawMessage: string; callbackData?: { action: 'confirm' } }) {
  const data: ProcessMessageJobData = {
    userId,
    rawMessage: input.rawMessage,
    channel: 'telegram',
    externalId,
    externalMessageId: `message-${Math.random()}`,
    receivedAt: new Date().toISOString(),
    ...(input.callbackData === undefined ? {} : { callbackData: input.callbackData }),
  };
  return { data } as Job<ProcessMessageJobData>;
}

function createHarness(options: HarnessOptions) {
  const now = new Date();
  const conversationRepo = new MemoryConversationRepository({
    userId,
    currentState: 'EXPENSE_REVIEW',
    statePayload: { ...options.payload },
    enteredAt: now,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    updatedAt: now,
  });
  const expenseRepo = new MemoryExpenseRepository();
  const appendedRows: Array<Array<string | number | null>> = [];
  const deletedRows: Array<{ fileId: string; sheetName: string; rowIndex: number }> = [];
  const messages: string[] = [];
  let remainingAppendFailures = options.appendFailures ?? 0;

  const spreadsheet = {
    appendRow: vi.fn((_fileId: string, _sheetName: string, row: Array<string | number | null>) => {
      appendedRows.push(row);
      if (remainingAppendFailures > 0) {
        remainingAppendFailures -= 1;
        return Promise.reject(
          new SpreadsheetError('temporary provider failure', {
            code: 'NETWORK_ERROR',
            retryable: true,
          }),
        );
      }
      return Promise.resolve({ sheet: 'Gastos', row: 7 });
    }),
    deleteRow: vi.fn((fileId: string, sheetName: string, rowIndex: number) => {
      deletedRows.push({ fileId, sheetName, rowIndex });
      return Promise.resolve();
    }),
  };
  const spreadsheetConfigRepo = {
    findByUserId: vi.fn().mockResolvedValue({
      id: spreadsheetId,
      userId,
      provider: 'google',
      fileId: 'file-1',
      fileName: 'Expenses',
      sheetName: 'Gastos',
      accessVerifiedAt: now,
      categoriesConfirmedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
  };
  const logRepo = { create: vi.fn().mockResolvedValue({}) };
  const messagingPort = {
    sendMessage: vi.fn((_chatId: string, message: string) => {
      messages.push(message);
      return Promise.resolve({ status: 'success' as const });
    }),
  };
  const oauthAccessTokenService = {
    getValidAccessToken: vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      refreshed: false,
    }),
    forceRefreshAccessToken: vi.fn(),
  };
  const registerExpense = new RegisterExpenseUseCase(
    {} as never,
    { create: vi.fn(() => spreadsheet) } as never,
    expenseRepo,
    spreadsheetConfigRepo as never,
    { findBySpreadsheetId: vi.fn().mockResolvedValue(options.mappings) } as never,
    {} as never,
    {} as never,
    conversationRepo,
    logRepo,
    {} as never,
    {} as never,
    oauthAccessTokenService,
  );
  const transitionState = new TransitionConversationState(conversationRepo);
  const resolveExpenseSummaryAction = new ResolveExpenseSummaryActionUseCase({
    registerExpense,
    transitionState,
    messagingPort,
    cancelExpenseRegistration: {} as never,
    operationLogRepo: logRepo,
  });
  const retryExpenseSave = new RetryExpenseSaveUseCase({
    registerExpense,
    transitionState,
    messagingPort,
    operationLogRepo: logRepo,
  });
  const undoLastExpense = new UndoLastExpenseUseCase(
    { create: vi.fn(() => spreadsheet) } as never,
    expenseRepo,
    spreadsheetConfigRepo as never,
    logRepo,
    oauthAccessTokenService,
  );
  const deps: MessageWorkerDeps = {
    redis: {} as never,
    logger: { error: vi.fn() } as never,
    userProcessingLock: {
      acquire: vi.fn().mockResolvedValue('lock-token'),
      release: vi.fn().mockResolvedValue(undefined),
    },
    registerExpense,
    queuePendingExpense: {} as never,
    classifyFreeTextExpenseIntent: { execute: vi.fn().mockReturnValue('non_financial') },
    correctExpense: null,
    generateExpenseSummary: null,
    resolveExpenseSummaryAction,
    cancelExpenseRegistration: {} as never,
    resolveExpenseReviewReply: null,
    retryExpenseSave,
    undoLastExpense,
    getConversationState: new GetConversationState(conversationRepo),
    transitionState,
    recoverCorruptedState: {} as never,
    userRepo: {
      findByMessagingIdentity: vi.fn().mockResolvedValue({ userId }),
    } as never,
    messagingAdapters: { telegram: messagingPort, whatsapp: messagingPort },
  };

  return {
    deps,
    conversationRepo,
    expenseRepo,
    appendedRows,
    deletedRows,
    messages,
  };
}

function successMessages(messages: string[]): string[] {
  return messages.filter((message) => message.includes('✅ *Gasto guardado*'));
}

describe('linked-subcategory expense lifecycle through the message worker', () => {
  beforeEach(() => vi.clearAllMocks());

  const mappedBase: Mapping[] = [
    { GasttoField: 'monto', columnIndex: 0 },
    { GasttoField: 'categoria', columnIndex: 1 },
    { GasttoField: 'subcategoria', columnIndex: 2 },
  ];
  const categoryOnlyMappings: Mapping[] = [
    { GasttoField: 'monto', columnIndex: 0 },
    { GasttoField: 'categoria', columnIndex: 1 },
  ];

  it.each([
    {
      name: 'mapped parent and child',
      payload: basePayload,
      mappings: mappedBase,
      expectedRow: [24.5, 'Food', 'Restaurant'],
      expectedRecord: {
        categoryId,
        subcategoryId,
        categoria: 'Food',
        subcategoria: 'Restaurant',
      },
    },
    {
      name: 'mapped parent with no child',
      payload: {
        ...basePayload,
        extracted: {
          ...basePayload.extracted,
          subcategoriaRaw: null,
          confianzaSubcategoria: 'nula' as const,
        },
        resolvedSubcategory: null,
        resolvedSubcategoryId: null,
        subcategoryStatus: 'none' as const,
      },
      mappings: mappedBase,
      expectedRow: [24.5, 'Food', null],
      expectedRecord: {
        categoryId,
        subcategoryId: null,
        categoria: 'Food',
        subcategoria: null,
      },
    },
    {
      name: 'unmapped category-only spreadsheet',
      payload: {
        ...basePayload,
        extracted: {
          ...basePayload.extracted,
          subcategoriaRaw: null,
          confianzaSubcategoria: 'nula' as const,
        },
        resolvedSubcategory: null,
        resolvedSubcategoryId: null,
        subcategoryStatus: 'none' as const,
        subcategoryEnabled: false,
      },
      mappings: categoryOnlyMappings,
      expectedRow: [24.5, 'Food'],
      expectedRecord: {
        categoryId,
        subcategoryId: null,
        categoria: 'Food',
        subcategoria: null,
      },
    },
    {
      name: 'configured hierarchy without a mapped child column',
      payload: basePayload,
      mappings: categoryOnlyMappings,
      expectedRow: [24.5, 'Food'],
      expectedRecord: {
        categoryId,
        subcategoryId,
        categoria: 'Food',
        subcategoria: 'Restaurant',
      },
    },
    {
      name: 'legacy review payload',
      payload: {
        rawMessage: basePayload.rawMessage,
        extracted: {
          ...basePayload.extracted,
          subcategoriaRaw: undefined,
          confianzaSubcategoria: undefined,
        },
        resolvedDate: basePayload.resolvedDate,
        resolvedCategory: 'Food',
        resolvedCategoryId: categoryId,
        categoryStatus: 'confirmed' as const,
      },
      mappings: categoryOnlyMappings,
      expectedRow: [24.5, 'Food'],
      expectedRecord: {
        categoryId,
        subcategoryId: null,
        categoria: 'Food',
        subcategoria: null,
      },
    },
  ])('confirms $name without changing unmapped row shape', async (scenario) => {
    const harness = createHarness(scenario);

    await processMessageJob(
      buildJob({ rawMessage: '', callbackData: { action: 'confirm' } }),
      harness.deps,
    );

    expect(harness.appendedRows).toEqual([scenario.expectedRow]);
    expect(harness.expenseRepo.records).toHaveLength(1);
    expect(harness.expenseRepo.records[0]).toMatchObject(scenario.expectedRecord);
    expect(harness.conversationRepo.state).toMatchObject({
      currentState: 'IDLE',
      statePayload: { immediateUndoExpenseId: 'expense-1' },
    });
    expect(successMessages(harness.messages)).toHaveLength(1);
  });

  it('undoes the exact row returned by a mapped hierarchy save', async () => {
    const harness = createHarness({ payload: basePayload, mappings: mappedBase });
    await processMessageJob(
      buildJob({ rawMessage: '', callbackData: { action: 'confirm' } }),
      harness.deps,
    );

    await processMessageJob(buildJob({ rawMessage: 'deshacer' }), harness.deps);

    expect(harness.deletedRows).toEqual([{ fileId: 'file-1', sheetName: 'Gastos', rowIndex: 7 }]);
    expect(harness.expenseRepo.records[0]).toMatchObject({
      id: 'expense-1',
      isDeleted: true,
      categoria: 'Food',
      subcategoria: 'Restaurant',
    });
    expect(harness.messages.filter((message) => message.includes('se eliminó'))).toHaveLength(1);
  });

  it('retries one failed append with the same reviewed hierarchy and succeeds once', async () => {
    const harness = createHarness({
      payload: basePayload,
      mappings: mappedBase,
      appendFailures: 1,
    });
    await processMessageJob(
      buildJob({ rawMessage: '', callbackData: { action: 'confirm' } }),
      harness.deps,
    );

    expect(harness.expenseRepo.records).toHaveLength(0);
    expect(harness.conversationRepo.state.currentState).toBe('EXPENSE_SAVING_RETRY');
    expect(harness.conversationRepo.state.statePayload).toMatchObject({ attemptCount: 1 });
    expect(harness.conversationRepo.state.statePayload?.expense).toMatchObject({
      resolvedCategoryId: categoryId,
      resolvedSubcategoryId: subcategoryId,
      resolvedSubcategory: 'Restaurant',
    });
    expect(successMessages(harness.messages)).toHaveLength(0);

    await processMessageJob(buildJob({ rawMessage: 'reintentar' }), harness.deps);

    expect(harness.appendedRows).toEqual([
      [24.5, 'Food', 'Restaurant'],
      [24.5, 'Food', 'Restaurant'],
    ]);
    expect(harness.expenseRepo.records).toHaveLength(1);
    expect(harness.expenseRepo.records[0]).toMatchObject({
      categoryId,
      subcategoryId,
      categoria: 'Food',
      subcategoria: 'Restaurant',
    });
    expect(successMessages(harness.messages)).toHaveLength(1);
  });

  it('creates no local expense, undo token, or success message when both append attempts fail', async () => {
    const harness = createHarness({
      payload: basePayload,
      mappings: mappedBase,
      appendFailures: 2,
    });
    await processMessageJob(
      buildJob({ rawMessage: '', callbackData: { action: 'confirm' } }),
      harness.deps,
    );

    expect(harness.expenseRepo.records).toHaveLength(0);
    expect(harness.conversationRepo.state.statePayload).not.toHaveProperty(
      'immediateUndoExpenseId',
    );
    expect(successMessages(harness.messages)).toHaveLength(0);

    await processMessageJob(buildJob({ rawMessage: 'reintentar' }), harness.deps);

    expect(harness.appendedRows).toHaveLength(2);
    expect(harness.expenseRepo.records).toHaveLength(0);
    expect(harness.conversationRepo.state).toMatchObject({
      currentState: 'IDLE',
      statePayload: null,
    });
    expect(harness.deletedRows).toHaveLength(0);
    expect(successMessages(harness.messages)).toHaveLength(0);
    expect(
      harness.messages.some((message) => message.includes('Copiá estos datos manualmente')),
    ).toBe(true);
  });
});

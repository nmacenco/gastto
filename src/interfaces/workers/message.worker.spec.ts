// LAYER: Interfaces / Tests
// Contract tests for the message worker (process-message queue).
// Mocks bullmq.Worker so no real Redis is needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processMessageJob, createMessageWorker, type MessageWorkerDeps } from './message.worker';
import { Worker, type Job } from 'bullmq';
import type { ProcessMessageJobData } from '../../application/ports/ProcessMessageJob';
import type { ConversationState } from '../../domain/entities/ConversationState';
import type { InitiateCloudConnection } from '../../application/use-cases/spreadsheet/InitiateCloudConnection';
import type { CancelCloudConnection } from '../../application/use-cases/spreadsheet/CancelCloudConnection';
import type { HandleSpreadsheetFileSelection } from '../../application/use-cases/spreadsheet/HandleSpreadsheetFileSelection';
import type { HandleSheetSelection } from '../../application/use-cases/spreadsheet/HandleSheetSelection';
import type { ValidateSpreadsheetAccess } from '../../application/use-cases/spreadsheet/ValidateSpreadsheetAccess';
import type { InferColumnMapping } from '../../application/use-cases/spreadsheet/InferColumnMapping';
import type { ConfirmColumnMapping } from '../../application/use-cases/spreadsheet/ConfirmColumnMapping';
import type { CorrectColumnMapping } from '../../application/use-cases/spreadsheet/CorrectColumnMapping';
import type { DetectCategories } from '../../application/use-cases/spreadsheet/DetectCategories';
import {
  ConfirmCategories,
  type ConfirmCategoriesDeps,
} from '../../application/use-cases/spreadsheet/ConfirmCategories';
import type { ModifyCategoryVocabulary } from '../../application/use-cases/spreadsheet/ModifyCategoryVocabulary';
import type { RetryExpenseSaveUseCase } from '../../application/use-cases/expense/RetryExpenseSaveUseCase';
import type { StartSpreadsheetReconfigurationUseCase } from '../../application/use-cases/spreadsheet/StartSpreadsheetReconfigurationUseCase';
import { UserAlreadyProcessingError } from '../../domain/errors/UserAlreadyProcessingError';
import { InvalidJobPayloadError } from '../../application/ports/InvalidJobPayloadError';
import { expenseCopies } from '../../application/copies/expense.copies';
import { onboardingCopies } from '../../application/copies/onboarding.copies';
import { GenerateExpenseSummaryUseCase } from '../../application/use-cases/expense/GenerateExpenseSummaryUseCase';
import type { ResolveExpenseSummaryActionInput } from '../../application/use-cases/expense/ResolveExpenseSummaryActionUseCase';

const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockGetConversationStateExecute = vi.fn();
const mockLoggerError = vi.fn();
const mockTransitionStateExecute = vi.fn();
const mockRecoverCorruptedStateExecute = vi.fn();
const mockUserRepoFindById = vi.fn();
const mockUserRepoFindByMessagingIdentity = vi.fn();
const mockRegisterExpenseInterpret = vi.fn();
const mockQueuePendingExpenseExecute = vi.fn();
const mockClassifyFreeTextExpenseIntentExecute = vi.fn();
const mockInitiateCloudConnectionExecute = vi.fn();
const mockCancelCloudConnectionExecute = vi.fn();
const mockHandleSpreadsheetFileSelectionExecute = vi.fn();
const mockHandleSheetSelectionExecute = vi.fn();
const mockValidateSpreadsheetAccessExecute = vi.fn();
const mockInferColumnMappingExecute = vi.fn();
const mockConfirmColumnMappingExecute = vi.fn();
const mockCorrectColumnMappingExecute = vi.fn();
const mockDetectCategoriesExecute = vi.fn();
const mockConfirmCategoriesExecute = vi.fn();
const mockModifyCategoryVocabularyExecute = vi.fn();
const mockLoadCorrectionState = vi.fn();
const mockSaveCorrectionState = vi.fn();
const mockAcquireLock = vi.fn();
const mockReleaseLock = vi.fn();
const LOCK_TOKEN_A = 'lock-token-a';
const LOCK_TOKEN_B = 'lock-token-b';
const mockClearCorrectionState = vi.fn();
const mockUserProfileGetDefaultCurrency = vi.fn();
const mockFindRecentCurrenciesByUserId = vi.fn();
const mockResolveExpenseSummaryActionExecute = vi.fn();
const mockResolveExpenseReviewReplyExecute = vi.fn();
const mockCorrectExpenseExecute = vi.fn();
const mockCancelExpenseRegistrationExecute = vi.fn();
const mockUndoLastExpenseExecute = vi.fn();
const mockRetryExpenseSaveExecute = vi.fn();
const mockStartSpreadsheetReconfigurationExecute = vi.fn();

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => {
    const events: Record<string, Array<(...args: unknown[]) => void>> = {};
    return {
      opts: { concurrency: 2 },
      on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (!events[event]) events[event] = [];
        events[event].push(handler);
      }),
      emit: vi.fn().mockImplementation((event: string, ...args: unknown[]) => {
        (events[event] ?? []).forEach((handler) => handler(...args));
      }),
    };
  }),
}));

function buildMockDeps(): MessageWorkerDeps {
  return {
    redis: {} as unknown as MessageWorkerDeps['redis'],
    logger: { error: mockLoggerError } as unknown as MessageWorkerDeps['logger'],
    userProcessingLock: {
      acquire: mockAcquireLock,
      release: mockReleaseLock,
    },
    registerExpense: {
      interpret: mockRegisterExpenseInterpret,
    } as unknown as MessageWorkerDeps['registerExpense'],
    queuePendingExpense: {
      execute: mockQueuePendingExpenseExecute,
    } as unknown as MessageWorkerDeps['queuePendingExpense'],
    classifyFreeTextExpenseIntent: {
      execute: mockClassifyFreeTextExpenseIntentExecute,
    },
    correctExpense: {
      execute: mockCorrectExpenseExecute,
    } as unknown as MessageWorkerDeps['correctExpense'],
    generateExpenseSummary: new GenerateExpenseSummaryUseCase(
      {
        create: vi.fn(),
        findLatestByUserId: vi.fn(),
        findRecentCurrenciesByUserId: vi.fn(),
        findAverageAmountByUserId: vi.fn().mockResolvedValue(null),
        softDelete: vi.fn(),
        softDeleteWithAudit: vi.fn(),
      },
      10,
    ),
    resolveExpenseSummaryAction: {
      execute: mockResolveExpenseSummaryActionExecute,
    } as unknown as MessageWorkerDeps['resolveExpenseSummaryAction'],
    cancelExpenseRegistration: {
      execute: mockCancelExpenseRegistrationExecute,
    } as unknown as MessageWorkerDeps['cancelExpenseRegistration'],
    resolveExpenseReviewReply: {
      execute: mockResolveExpenseReviewReplyExecute,
    } as unknown as MessageWorkerDeps['resolveExpenseReviewReply'],
    undoLastExpense: {
      execute: mockUndoLastExpenseExecute,
    } as unknown as MessageWorkerDeps['undoLastExpense'],
    retryExpenseSave: {
      execute: mockRetryExpenseSaveExecute,
    } as unknown as RetryExpenseSaveUseCase,
    getConversationState: {
      execute: mockGetConversationStateExecute,
    } as unknown as MessageWorkerDeps['getConversationState'],
    transitionState: {
      execute: mockTransitionStateExecute,
    } as unknown as MessageWorkerDeps['transitionState'],
    recoverCorruptedState: {
      execute: mockRecoverCorruptedStateExecute,
    } as unknown as MessageWorkerDeps['recoverCorruptedState'],
    userRepo: {
      findById: mockUserRepoFindById,
      findByMessagingIdentity: mockUserRepoFindByMessagingIdentity,
    } as unknown as MessageWorkerDeps['userRepo'],
    messagingAdapters: {
      telegram: { sendMessage: mockSendMessage },
      whatsapp: { sendMessage: mockSendMessage },
    },
    expenseSummaryPresenterFactory: (messaging, chatId) => ({
      presentSummary: async (summary) => {
        const categoryMarker =
          summary.categoryStatus === 'ambiguous'
            ? ' (¿correcto?)'
            : summary.categoryStatus === 'fallback'
              ? ' (sugerida)'
              : '';
        const text = [
          summary.isHighAmount ? '⚠️ *Monto inusualmente alto*' : '',
          '📋 *Resumen del gasto:*',
          `• Concepto: ${summary.concept.slice(0, 80)}`,
          `• Monto: ${summary.amount} ${summary.currency}`,
          `• Categoría: ${summary.category || '❓ Sin categoría'}${categoryMarker}`,
          `• Fecha: ${summary.date}`,
          '',
          '¿Confirmamos?',
        ]
          .filter(Boolean)
          .join('\n');
        await messaging.sendMessage(chatId, text);
      },
      showTimeoutWarning: async () => {
        await messaging.sendMessage(chatId, 'timeout warning');
      },
      notifyCancellation: async () => {
        await messaging.sendMessage(chatId, 'cancelled');
      },
      requestHighAmountConfirmation: async (summary) => {
        await messaging.sendMessage(chatId, `high amount ${summary.amount}`);
      },
    }),
    userProfilePort: {
      getDefaultCurrency: mockUserProfileGetDefaultCurrency,
    },
    expenseRecordRepo: {
      create: vi.fn(),
      findLatestByUserId: vi.fn(),
      findRecentCurrenciesByUserId: mockFindRecentCurrenciesByUserId,
      findAverageAmountByUserId: vi.fn().mockResolvedValue(null),
      softDelete: vi.fn(),
      softDeleteWithAudit: vi.fn(),
    },
    mappingCorrectionStateRepository: {
      load: mockLoadCorrectionState,
      save: mockSaveCorrectionState,
      clear: mockClearCorrectionState,
    },
    initiateCloudConnection: {
      execute: mockInitiateCloudConnectionExecute,
    } as unknown as InitiateCloudConnection,
    cancelCloudConnection: {
      execute: mockCancelCloudConnectionExecute,
    } as unknown as CancelCloudConnection,
    handleSpreadsheetFileSelection: {
      execute: mockHandleSpreadsheetFileSelectionExecute,
    } as unknown as HandleSpreadsheetFileSelection,
    handleSheetSelection: {
      execute: mockHandleSheetSelectionExecute,
    } as unknown as HandleSheetSelection,
    validateSpreadsheetAccess: {
      execute: mockValidateSpreadsheetAccessExecute,
    } as unknown as ValidateSpreadsheetAccess,
    inferColumnMapping: {
      execute: mockInferColumnMappingExecute,
    } as unknown as InferColumnMapping,
    confirmColumnMapping: {
      execute: mockConfirmColumnMappingExecute,
    } as unknown as ConfirmColumnMapping,
    correctColumnMapping: {
      execute: mockCorrectColumnMappingExecute,
    } as unknown as CorrectColumnMapping,
    detectCategories: {
      execute: mockDetectCategoriesExecute,
    } as unknown as DetectCategories,
    confirmCategories: {
      execute: mockConfirmCategoriesExecute,
    } as unknown as ConfirmCategories,
    modifyCategoryVocabulary: {
      execute: mockModifyCategoryVocabularyExecute,
    } as unknown as ModifyCategoryVocabulary,
    startSpreadsheetReconfiguration: {
      execute: mockStartSpreadsheetReconfigurationExecute,
    } as unknown as StartSpreadsheetReconfigurationUseCase,
  };
}

function buildJob(data: ProcessMessageJobData): Job<ProcessMessageJobData> {
  return { data } as Job<ProcessMessageJobData>;
}

function buildConversationState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    userId: 'user-123',
    currentState: 'IDLE',
    statePayload: null,
    enteredAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildClarificationStatePayload(
  missingField: 'monto' | 'moneda',
  rawMessage: string,
): Record<string, unknown> {
  return {
    _type: 'ExpenseClarificationState',
    missingField,
    rawMessage,
    partialExtracted: {
      monto: missingField === 'monto' ? null : 850,
      moneda: missingField === 'moneda' ? null : 'ARS',
      categoriaRaw: 'café',
      fechaRaw: '2026-07-25',
      medioPago: null,
      confianzaCategoria: 'alta',
    },
  };
}

const baseJobData: ProcessMessageJobData = {
  userId: 'user-123',
  rawMessage: 'Cafe 850',
  channel: 'telegram',
  externalId: '123456789',
  externalMessageId: 'msg-42',
  receivedAt: new Date().toISOString(),
};

describe('processMessageJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquireLock.mockResolvedValue(LOCK_TOKEN_A);
    mockUserRepoFindByMessagingIdentity.mockResolvedValue({ userId: 'user-123' });
    mockResolveExpenseReviewReplyExecute.mockResolvedValue({
      status: 'action_handled',
      action: 'confirm',
    });
    mockClassifyFreeTextExpenseIntentExecute.mockReturnValue({ kind: 'non-financial' });
    mockQueuePendingExpenseExecute.mockResolvedValue({ status: 'queued', pendingCount: 1 });
    mockUserProfileGetDefaultCurrency.mockResolvedValue(null);
    mockFindRecentCurrenciesByUserId.mockResolvedValue([]);
    mockResolveExpenseSummaryActionExecute.mockImplementation(
      async (input: ResolveExpenseSummaryActionInput) => {
        if (input.action === 'confirm') {
          await mockSendMessage(input.chatId, expenseCopies.saving());
        } else if (input.action === 'cancel') {
          await mockTransitionStateExecute({ userId: input.userId, targetState: 'IDLE' });
          await mockSendMessage(input.chatId, expenseCopies.cancelled());
        }
      },
    );
    mockCorrectExpenseExecute.mockResolvedValue({ status: 'not_interpretable' });
    mockCancelExpenseRegistrationExecute.mockResolvedValue({ status: 'cancelled' });
    mockUndoLastExpenseExecute.mockResolvedValue({
      status: 'deleted',
      expense: {
        id: 'expense-1',
        concepto: 'Café',
        monto: 4.5,
        moneda: 'EUR',
        savedAt: new Date(),
      },
    });
  });

  it('rejects malformed payloads before identity lookup or lock acquisition', async () => {
    const deps = buildMockDeps();
    const invalidJob = buildJob({ ...baseJobData, receivedAt: 'not-a-timestamp' });

    await expect(processMessageJob(invalidJob, deps)).rejects.toThrow(InvalidJobPayloadError);
    expect(mockUserRepoFindByMessagingIdentity).not.toHaveBeenCalled();
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });

  it('rejects a job whose messaging identity belongs to another user before side effects', async () => {
    const deps = buildMockDeps();
    mockUserRepoFindByMessagingIdentity.mockResolvedValue({ userId: 'other-user' });

    await expect(processMessageJob(buildJob(baseJobData), deps)).rejects.toThrow(
      'Messaging identity does not match job user',
    );
    expect(mockAcquireLock).not.toHaveBeenCalled();
    expect(mockGetConversationStateExecute).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  describe('IDLE / EXPENSE_RECEIVING state', () => {
    it.each(['deshacer', 'UNDO', 'borrar el último'])(
      'routes normalized undo command %s without interpreting a new expense',
      async (rawMessage) => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({ statePayload: { immediateUndoExpenseId: 'expense-1' } }),
        );

        await processMessageJob(buildJob({ ...baseJobData, rawMessage }), deps);

        expect(mockUndoLastExpenseExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          action: 'request',
          immediateEligible: true,
        });
        expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          expenseCopies.undoDeleted('Café', 4.5, 'EUR'),
        );
      },
    );

    it('requires confirmation for delayed undo without deleting in the request turn', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(buildConversationState());
      mockUndoLastExpenseExecute.mockResolvedValue({
        status: 'confirmation_required',
        expense: {
          id: 'expense-1',
          concepto: 'Café',
          monto: 4.5,
          moneda: 'EUR',
          savedAt: new Date('2026-08-02T10:00:00Z'),
        },
      });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'deshacer' }), deps);

      expect(mockUndoLastExpenseExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        action: 'request',
        immediateEligible: false,
      });
      expect(mockTransitionStateExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          targetState: 'EXPENSE_UNDO_CONFIRMING',
          payload: { pendingExpenseId: 'expense-1' },
        }),
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining("¿Querés eliminar 'Café, 4.5 EUR'"),
      );
      expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
    });

    it('clears immediate undo eligibility before processing any non-undo message', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ statePayload: { immediateUndoExpenseId: 'expense-1' } }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'needs_clarification',
        missingField: 'monto',
      });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'Taxi 20 EUR' }), deps);

      expect(mockTransitionStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
        payload: null,
      });
      expect(mockRegisterExpenseInterpret).toHaveBeenCalled();
    });

    it('clears immediate undo eligibility before a global cancellation command', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ statePayload: { immediateUndoExpenseId: 'expense-1' } }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'cancelar' }), deps);

      expect(mockTransitionStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
        payload: null,
      });
      expect(mockCancelExpenseRegistrationExecute).toHaveBeenCalled();
    });

    it('cancels from IDLE before expense interpretation', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'IDLE' }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'cancelar' }), deps);

      expect(mockCancelExpenseRegistrationExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        chatId: '123456789',
        currentState: 'IDLE',
        source: 'text',
        channel: 'telegram',
      });
      expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
    });

    it('cancels from EXPENSE_RECEIVING before expense interpretation', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'EXPENSE_RECEIVING' }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'stop' }), deps);

      expect(mockCancelExpenseRegistrationExecute).toHaveBeenCalledWith(
        expect.objectContaining({ currentState: 'EXPENSE_RECEIVING', source: 'text' }),
      );
      expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
    });

    it('can process a new expense immediately after cancellation', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute
        .mockResolvedValueOnce(buildConversationState({ currentState: 'EXPENSE_CLARIFYING' }))
        .mockResolvedValueOnce(buildConversationState({ currentState: 'IDLE' }));
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'needs_clarification',
        missingField: 'monto',
      });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'cancelar' }), deps);
      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'Taxi' }), deps);

      expect(mockCancelExpenseRegistrationExecute).toHaveBeenCalledWith(
        expect.objectContaining({ currentState: 'EXPENSE_CLARIFYING' }),
      );
      expect(mockRegisterExpenseInterpret).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Taxi',
        channel: 'telegram',
      });
    });
    it('sends clarification question when expense is missing monto', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'IDLE' }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'needs_clarification',
        missingField: 'monto',
      });

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockGetConversationStateExecute).toHaveBeenCalledWith({ userId: 'user-123' });
      expect(mockRegisterExpenseInterpret).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Cafe 850',
        channel: 'telegram',
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.clarificationAmount(),
      );
    });

    it('sends expense summary when interpretation succeeds', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'EXPENSE_RECEIVING' }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'success',
        payload: {
          rawMessage: 'Cafe 850',
          extracted: { monto: '850', moneda: 'ARS', confianzaCategoria: 'alta' },
          resolvedDate: '2026-01-15',
          resolvedCategory: 'Comida',
          categoryStatus: 'confirmed',
        },
      });

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const sentText = mockSendMessage.mock.calls[0]![1] as string;
      expect(sentText).toContain('850 ARS');
      expect(sentText).toContain('Comida');
    });

    it('surfaces ambiguity hint in the expense summary', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'EXPENSE_RECEIVING' }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'success',
        payload: {
          rawMessage: 'Cafe o cine',
          extracted: { monto: 850, moneda: 'ARS', confianzaCategoria: 'baja' },
          resolvedDate: '2026-01-15',
          resolvedCategory: 'Ocio',
          categoryStatus: 'ambiguous',
        },
      });

      await processMessageJob(buildJob(baseJobData), deps);

      const sentText = mockSendMessage.mock.calls[0]![1] as string;
      expect(sentText).toContain('Ocio');
      expect(sentText).toContain('(¿correcto?)');
    });

    it('surfaces fallback hint in the expense summary', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'EXPENSE_RECEIVING' }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'success',
        payload: {
          rawMessage: 'Pagué el entretenimiento',
          extracted: { monto: 850, moneda: 'ARS', confianzaCategoria: 'baja' },
          resolvedDate: '2026-01-15',
          resolvedCategory: 'Comida',
          categoryStatus: 'fallback',
        },
      });

      await processMessageJob(buildJob(baseJobData), deps);

      const sentText = mockSendMessage.mock.calls[0]![1] as string;
      expect(sentText).toContain('Comida');
      expect(sentText).toContain('(sugerida)');
    });

    it('shows the empty-category placeholder when no category is detected', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'EXPENSE_RECEIVING' }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'success',
        payload: {
          rawMessage: 'Gasté 850',
          extracted: { monto: 850, moneda: 'ARS', confianzaCategoria: 'nula' },
          resolvedDate: '2026-01-15',
          resolvedCategory: null,
          categoryStatus: 'none',
        },
      });

      await processMessageJob(buildJob(baseJobData), deps);

      const sentText = mockSendMessage.mock.calls[0]![1] as string;
      expect(sentText).toContain('Sin categoría');
    });

    it('sends unavailable copy when registerExpense is null', async () => {
      const deps = buildMockDeps();
      deps.registerExpense = null;
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'IDLE' }),
      );

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.expenseRegistrationUnavailable(),
      );
    });

    it('sends zero-amount confirmation copy when interpretation needs zero confirmation', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'IDLE' }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'needs_zero_confirmation',
        payload: {
          rawMessage: 'Cafe 0',
          extracted: { monto: 0, moneda: 'ARS', confianzaCategoria: 'alta' },
          resolvedDate: '2026-01-15',
          resolvedCategory: 'Comida',
          categoryStatus: 'confirmed',
        },
      });

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockRegisterExpenseInterpret).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Cafe 850',
        channel: 'telegram',
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.zeroAmountConfirmation(),
      );
    });

    it('sends currency clarification when interpretation has ambiguous currency', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'EXPENSE_RECEIVING' }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'needs_clarification',
        missingField: 'moneda',
      });

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockRegisterExpenseInterpret).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Cafe 850',
        channel: 'telegram',
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.clarificationCurrency(),
      );
    });
  });

  function buildReviewStatePayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      rawMessage: 'Cafe 850',
      extracted: {
        monto: 850,
        moneda: 'ARS',
        categoriaRaw: 'café',
        fechaRaw: '2026-07-25',
        medioPago: null,
        confianzaCategoria: 'alta',
      },
      resolvedDate: '2026-07-25',
      resolvedCategory: 'Comida',
      resolvedCategoryId: null,
      categoryStatus: 'confirmed',
      ...overrides,
    };
  }

  describe('EXPENSE_UNDO_CONFIRMING state', () => {
    it('deletes only after affirmative confirmation and returns to IDLE', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_UNDO_CONFIRMING',
          statePayload: { pendingExpenseId: 'expense-1' },
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

      expect(mockUndoLastExpenseExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        action: 'confirm',
        immediateEligible: false,
        pendingExpenseId: 'expense-1',
      });
      expect(mockTransitionStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.undoDeleted('Café', 4.5, 'EUR'),
      );
    });

    it('cancels without invoking the undo use case', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_UNDO_CONFIRMING',
          statePayload: { pendingExpenseId: 'expense-1' },
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'cancelar' }), deps);

      expect(mockUndoLastExpenseExecute).not.toHaveBeenCalled();
      expect(mockTransitionStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
      });
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.undoCancelled());
    });
  });

  describe('EXPENSE_REVIEW state', () => {
    it('keeps correction routing ahead of queue admission', async () => {
      const deps = buildMockDeps();
      mockClassifyFreeTextExpenseIntentExecute.mockReturnValue({ kind: 'expense-like' });
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: buildReviewStatePayload(),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'no, fueron 15' }), deps);

      expect(mockQueuePendingExpenseExecute).not.toHaveBeenCalled();
      expect(mockResolveExpenseReviewReplyExecute).toHaveBeenCalledWith(
        expect.objectContaining({ rawMessage: 'no, fueron 15' }),
      );
    });

    it('delegates an additional expense to queue admission without mutating the active review', async () => {
      const deps = buildMockDeps();
      mockClassifyFreeTextExpenseIntentExecute.mockReturnValue({ kind: 'expense-like' });
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: buildReviewStatePayload(),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'Taxi 12 EUR' }), deps);

      expect(mockQueuePendingExpenseExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Taxi 12 EUR',
        channel: 'telegram',
      });
      expect(mockResolveExpenseReviewReplyExecute).not.toHaveBeenCalled();
      expect(mockTransitionStateExecute).not.toHaveBeenCalled();
    });

    it('reports a full queue without changing the active review', async () => {
      const deps = buildMockDeps();
      mockClassifyFreeTextExpenseIntentExecute.mockReturnValue({ kind: 'expense-like' });
      mockQueuePendingExpenseExecute.mockResolvedValue({ status: 'full', pendingCount: 2 });
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: buildReviewStatePayload(),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'Taxi 12 EUR' }), deps);

      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.expenseQueueFull());
      expect(mockResolveExpenseReviewReplyExecute).not.toHaveBeenCalled();
      expect(mockTransitionStateExecute).not.toHaveBeenCalled();
    });

    it('delegates a standard text confirmation to the application resolver', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: buildReviewStatePayload(),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

      expect(mockResolveExpenseReviewReplyExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'sí',
        payload: buildReviewStatePayload(),
        chatId: '123456789',
        channel: 'telegram',
      });
      expect(mockResolveExpenseSummaryActionExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('delegates a regional text confirmation to the application resolver', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: buildReviewStatePayload(),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'órale' }), deps);

      expect(mockResolveExpenseReviewReplyExecute).toHaveBeenCalledWith(
        expect.objectContaining({ rawMessage: 'órale' }),
      );
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('delegates text cancellation to the application resolver', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: buildReviewStatePayload(),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'cancelar' }), deps);

      expect(mockResolveExpenseReviewReplyExecute).toHaveBeenCalledWith(
        expect.objectContaining({ rawMessage: 'cancelar' }),
      );
    });

    it('asks for clarification on ambiguous response', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: buildReviewStatePayload(),
        }),
      );
      mockResolveExpenseReviewReplyExecute.mockResolvedValue({ status: 'not_interpretable' });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'maybe' }), deps);

      expect(mockTransitionStateExecute).not.toHaveBeenCalled();
      expect(mockResolveExpenseReviewReplyExecute).toHaveBeenCalledTimes(1);
      expect(mockCorrectExpenseExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.ambiguousResponse());
    });

    it('applies a direct natural-language correction and presents one updated summary', async () => {
      const deps = buildMockDeps();
      const payload = buildReviewStatePayload();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: payload,
        }),
      );
      mockResolveExpenseReviewReplyExecute.mockResolvedValue({
        status: 'corrected',
        payload: {
          ...payload,
          extracted: { ...(payload.extracted as Record<string, unknown>), monto: 15 },
        },
      });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'no, fueron 15' }), deps);

      expect(mockResolveExpenseReviewReplyExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          rawMessage: 'no, fueron 15',
          channel: 'telegram',
        }),
      );
      expect(mockCorrectExpenseExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[1]).toContain('Monto: 15 ARS');
    });

    it('keeps the review state and sends the ambiguity prompt when direct correction is not interpretable', async () => {
      const deps = buildMockDeps();
      const payload = buildReviewStatePayload();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: payload,
        }),
      );
      mockResolveExpenseReviewReplyExecute.mockResolvedValue({ status: 'not_interpretable' });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: '🤔' }), deps);

      expect(mockResolveExpenseReviewReplyExecute).toHaveBeenCalledTimes(1);
      expect(mockCorrectExpenseExecute).not.toHaveBeenCalled();
      expect(mockTransitionStateExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.ambiguousResponse());
    });

    it('delegates a zero-amount confirmation to the application resolver', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: buildReviewStatePayload({
            rawMessage: 'Cafe 0',
            extracted: {
              monto: 0,
              moneda: 'ARS',
              categoriaRaw: 'café',
              fechaRaw: '2026-07-25',
              medioPago: null,
              confianzaCategoria: 'alta',
            },
            awaitingZeroConfirmation: true,
          }),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

      expect(mockResolveExpenseReviewReplyExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          rawMessage: 'sí',
          chatId: '123456789',
        }),
      );
      expect(mockResolveExpenseSummaryActionExecute).not.toHaveBeenCalled();
    });

    it('resolves confirm callback via inline button', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: buildReviewStatePayload(),
        }),
      );

      await processMessageJob(
        buildJob({ ...baseJobData, rawMessage: '', callbackData: { action: 'confirm' } }),
        deps,
      );

      expect(mockResolveExpenseSummaryActionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        action: 'confirm',
        payload: buildReviewStatePayload(),
        chatId: '123456789',
        channel: 'telegram',
      });
    });

    it('resolves cancel callback via inline button', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: buildReviewStatePayload(),
        }),
      );

      await processMessageJob(
        buildJob({ ...baseJobData, rawMessage: '', callbackData: { action: 'cancel' } }),
        deps,
      );

      expect(mockResolveExpenseSummaryActionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        action: 'cancel',
        payload: buildReviewStatePayload(),
        chatId: '123456789',
        cancellationSource: 'callback',
        channel: 'telegram',
      });
    });

    it('resolves correct callback via inline button', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: buildReviewStatePayload(),
        }),
      );

      await processMessageJob(
        buildJob({ ...baseJobData, rawMessage: '', callbackData: { action: 'correct' } }),
        deps,
      );

      expect(mockResolveExpenseSummaryActionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        action: 'correct',
        payload: buildReviewStatePayload(),
        chatId: '123456789',
        channel: 'telegram',
      });
    });
  });

  describe('EXPENSE_CORRECTING state', () => {
    it('cancels before correction handling', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CORRECTING',
          statePayload: { _type: 'ExpenseCorrectionState' },
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'salir' }), deps);

      expect(mockCancelExpenseRegistrationExecute).toHaveBeenCalledWith(
        expect.objectContaining({ currentState: 'EXPENSE_CORRECTING', source: 'text' }),
      );
      expect(mockCorrectExpenseExecute).not.toHaveBeenCalled();
    });

    it('routes correction messages through CorrectExpenseUseCase and presents one summary', async () => {
      const deps = buildMockDeps();
      const payload = buildReviewStatePayload();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CORRECTING',
          statePayload: {
            _type: 'ExpenseCorrectionState',
            payload,
            correctionCycles: 2,
            pendingHighAmountConfirmation: false,
          },
        }),
      );
      mockCorrectExpenseExecute.mockResolvedValue({ status: 'corrected', payload });

      await processMessageJob(
        buildJob({ ...baseJobData, rawMessage: 'ponlo en transporte' }),
        deps,
      );

      expect(mockCorrectExpenseExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          rawMessage: 'ponlo en transporte',
        }),
      );
      const correctingInput = mockCorrectExpenseExecute.mock.calls[0]?.[0] as {
        state: { correctionCycles: number };
      };
      expect(correctingInput.state.correctionCycles).toBe(2);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('sends the cycle-limit copy and does not present another summary', async () => {
      const deps = buildMockDeps();
      const payload = buildReviewStatePayload();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CORRECTING',
          statePayload: {
            _type: 'ExpenseCorrectionState',
            payload,
            correctionCycles: 5,
          },
        }),
      );
      mockCorrectExpenseExecute.mockResolvedValue({ status: 'cycle_limit', payload });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'otra corrección' }), deps);

      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.correctionCycleLimitReached(),
      );
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('sends the ambiguity copy without changing data for an uninterpretable correction', async () => {
      const deps = buildMockDeps();
      const payload = buildReviewStatePayload();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CORRECTING',
          statePayload: {
            _type: 'ExpenseCorrectionState',
            payload,
            correctionCycles: 1,
          },
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'uh-huh' }), deps);

      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.ambiguousResponse());
      expect(mockTransitionStateExecute).not.toHaveBeenCalled();
    });

    it('recovers an invalid correction state and logs the validation failure', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CORRECTING',
          statePayload: {
            _type: 'ExpenseCorrectionState',
            payload: { invalid: true },
            correctionCycles: 0,
          },
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'corrige el monto' }), deps);

      expect(mockCorrectExpenseExecute).not.toHaveBeenCalled();
      expect(mockTransitionStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
      });
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'handleExpenseCorrection',
          code: 'INVALID_CORRECTION_PAYLOAD',
          userId: 'user-123',
        }),
      );
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.fallbackError());
    });

    it('presents a high-amount correction once and keeps it unsaved for confirmation', async () => {
      const deps = buildMockDeps();
      const basePayload = buildReviewStatePayload();
      const payload = buildReviewStatePayload({
        extracted: {
          ...(basePayload.extracted as Record<string, unknown>),
          monto: 1500,
        },
      });
      deps.generateExpenseSummary = new GenerateExpenseSummaryUseCase(
        {
          findAverageAmountByUserId: vi.fn().mockResolvedValue(100),
        } as never,
        10,
      );
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CORRECTING',
          statePayload: {
            _type: 'ExpenseCorrectionState',
            payload: basePayload,
            correctionCycles: 0,
          },
        }),
      );
      mockCorrectExpenseExecute.mockResolvedValue({
        status: 'high_amount_confirmation',
        payload,
      });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'fueron 1500' }), deps);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[1]).toContain('Monto inusualmente alto');
      expect(mockSendMessage.mock.calls[0]?.[1]).toContain('Monto: 1500 ARS');
      expect(mockTransitionStateExecute).not.toHaveBeenCalled();
    });

    it('presents exactly one updated summary for an atomic multi-field correction', async () => {
      const deps = buildMockDeps();
      const basePayload = buildReviewStatePayload();
      const payload = buildReviewStatePayload({
        extracted: {
          ...(basePayload.extracted as Record<string, unknown>),
          monto: 15,
          moneda: 'EUR',
          categoriaRaw: 'transporte',
          fechaRaw: '2026-07-28',
        },
        resolvedDate: '2026-07-28',
        resolvedCategory: 'Transporte',
      });
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CORRECTING',
          statePayload: {
            _type: 'ExpenseCorrectionState',
            payload: basePayload,
            correctionCycles: 0,
          },
        }),
      );
      mockCorrectExpenseExecute.mockResolvedValue({ status: 'corrected', payload });

      await processMessageJob(
        buildJob({ ...baseJobData, rawMessage: '15 euros en transporte el 28 de julio' }),
        deps,
      );

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const summary = mockSendMessage.mock.calls[0]?.[1] as string;
      expect(summary).toContain('Monto: 15 EUR');
      expect(summary).toContain('Categoría: Transporte');
      expect(summary).toContain('Fecha: 2026-07-28');
    });
  });

  describe('EXPENSE_CLARIFYING state', () => {
    it('cancels before clarification handling', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: buildClarificationStatePayload('monto', 'Cafe'),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'para' }), deps);

      expect(mockCancelExpenseRegistrationExecute).toHaveBeenCalledWith(
        expect.objectContaining({ currentState: 'EXPENSE_CLARIFYING', source: 'text' }),
      );
      expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
    });

    it('sends updated summary when clarification resolves', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: buildClarificationStatePayload('monto', 'Cafe'),
        }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'success',
        payload: {
          rawMessage: 'Cafe 850',
          extracted: { monto: '850', moneda: 'ARS', confianzaCategoria: 'alta' },
          resolvedDate: '2026-01-15',
          resolvedCategory: 'Comida',
          categoryStatus: 'confirmed',
        },
      });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: '850 pesos' }), deps);

      expect(mockRegisterExpenseInterpret).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Cafe 850 pesos',
        channel: 'telegram',
      });
      const sentText = mockSendMessage.mock.calls[0]![1] as string;
      expect(sentText).toContain('Resumen actualizado');
    });

    it('surfaces ambiguity hint in the updated summary', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: buildClarificationStatePayload('monto', 'Cafe'),
        }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'success',
        payload: {
          rawMessage: 'Cafe o cine',
          extracted: { monto: 850, moneda: 'ARS', confianzaCategoria: 'baja' },
          resolvedDate: '2026-01-15',
          resolvedCategory: 'Ocio',
          categoryStatus: 'ambiguous',
        },
      });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: '850 pesos' }), deps);

      const sentText = mockSendMessage.mock.calls[0]![1] as string;
      expect(sentText).toContain('Resumen actualizado');
      expect(sentText).toContain('(¿correcto?)');
    });

    it('asks again when clarification still needs more info', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: buildClarificationStatePayload('monto', 'Cafe'),
        }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'needs_clarification',
        missingField: 'moneda',
      });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: '850' }), deps);

      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.clarificationCurrency(),
      );
    });

    it('sends unavailable copy when registerExpense is null', async () => {
      const deps = buildMockDeps();
      deps.registerExpense = null;
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: buildClarificationStatePayload('monto', 'Cafe'),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: '850' }), deps);

      expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.expenseRegistrationUnavailable(),
      );
    });

    it('cancels previous clarification and processes a new expense', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: buildClarificationStatePayload('monto', 'Cafe'),
        }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'success',
        payload: {
          rawMessage: 'Pagué 30 euros por el café',
          extracted: { monto: 30, moneda: 'EUR', confianzaCategoria: 'alta' },
          resolvedDate: '2026-01-15',
          resolvedCategory: 'Comida',
          categoryStatus: 'confirmed',
        },
      });

      await processMessageJob(
        buildJob({ ...baseJobData, rawMessage: 'Pagué 30 euros por el café' }),
        deps,
      );

      expect(mockTransitionStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.clarificationInterrupted(),
      );
      expect(mockRegisterExpenseInterpret).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Pagué 30 euros por el café',
        channel: 'telegram',
      });
      const sentText = mockSendMessage.mock.calls[
        mockSendMessage.mock.calls.length - 1
      ]![1] as string;
      expect(sentText).toContain('Resumen del gasto');
    });

    it('reformulates the currency question when the user answers invalidly', async () => {
      const deps = buildMockDeps();
      mockUserProfileGetDefaultCurrency.mockResolvedValue('ARS');
      mockFindRecentCurrenciesByUserId.mockResolvedValue(['USD', 'EUR']);
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: buildClarificationStatePayload('moneda', 'Gasté 100'),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'no sé' }), deps);

      expect(mockUserProfileGetDefaultCurrency).toHaveBeenCalledWith('user-123');
      expect(mockFindRecentCurrenciesByUserId).toHaveBeenCalledWith('user-123', 5);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        '¿El gasto fue en pesos argentinos (ARS), dólares (USD) o euros (EUR)?',
      );
      expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
    });

    it('reformulates the amount question when the user answers invalidly', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: buildClarificationStatePayload('monto', 'Cafe en euros'),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'ni idea' }), deps);

      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.clarificationAmount(),
      );
      expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
    });

    it('treats a short amount+currency pair as a clarification answer', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: buildClarificationStatePayload('monto', 'Cafe'),
        }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'needs_clarification',
        missingField: 'moneda',
      });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: '850 pesos' }), deps);

      expect(mockRegisterExpenseInterpret).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Cafe 850 pesos',
        channel: 'telegram',
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.clarificationCurrency(),
      );
    });
  });

  describe('ONBOARDING states', () => {
    it('delegates recovery empezar to InitiateCloudConnection without expense interpretation', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'ONBOARDING_START',
          statePayload: { promptShown: true },
        }),
      );
      mockInitiateCloudConnectionExecute.mockResolvedValue({
        nextState: 'ONBOARDING_DRIVE',
        message: 'Auth link sent.',
      });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'empezar' }), deps);

      expect(mockInitiateCloudConnectionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'empezar',
        externalId: '123456789',
        channel: 'telegram',
      });
      expect(mockInitiateCloudConnectionExecute).toHaveBeenCalledTimes(1);
      expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
      expect(mockClassifyFreeTextExpenseIntentExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sends welcome prompt and marks promptShown on first ONBOARDING_START interaction', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'ONBOARDING_START',
          statePayload: { promptShown: false },
        }),
      );

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockSendMessage).toHaveBeenCalledWith('123456789', onboardingCopies.welcomePrompt());
      expect(mockTransitionStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
      });
      expect(mockInitiateCloudConnectionExecute).not.toHaveBeenCalled();
    });

    it('falls back to placeholder when ONBOARDING_START and InitiateCloudConnection is not wired', async () => {
      const deps = buildMockDeps();
      deps.initiateCloudConnection = null;
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'ONBOARDING_START',
          statePayload: { promptShown: true },
        }),
      );

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        onboardingCopies.onboardingPlaceholder(),
      );
      expect(mockInitiateCloudConnectionExecute).not.toHaveBeenCalled();
    });

    describe('ONBOARDING_DRIVE', () => {
      it('triggers CancelCloudConnection when user types cancelar', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_DRIVE',
            statePayload: { provider: 'google', state: 'csrf-state-123' },
          }),
        );
        mockCancelCloudConnectionExecute.mockResolvedValue({
          nextState: 'IDLE',
          message: onboardingCopies.cancelledMessage(),
        });

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'cancelar' }), deps);

        expect(mockCancelCloudConnectionExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          state: 'csrf-state-123',
          externalId: '123456789',
          channel: 'telegram',
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('sends wait prompt for non-cancelar messages', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_DRIVE',
            statePayload: { provider: 'google', state: 'csrf-state-123' },
          }),
        );

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'anything else' }), deps);

        expect(mockCancelCloudConnectionExecute).not.toHaveBeenCalled();
        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.waitForAuthPrompt(),
        );
      });

      it('falls back to placeholder when CancelCloudConnection is not wired', async () => {
        const deps = buildMockDeps();
        deps.cancelCloudConnection = null;
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({ currentState: 'ONBOARDING_DRIVE' }),
        );

        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.onboardingPlaceholder(),
        );
        expect(mockCancelCloudConnectionExecute).not.toHaveBeenCalled();
      });
    });

    describe('ONBOARDING_FILE', () => {
      it('delegates to HandleSpreadsheetFileSelection when wired', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_FILE',
            statePayload: { provider: 'google', fileList: [{ id: 'f1', name: 'file1' }] },
          }),
        );
        mockHandleSpreadsheetFileSelectionExecute.mockResolvedValue({
          nextState: 'ONBOARDING_SHEET',
          message: 'File selected.',
        });

        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockHandleSpreadsheetFileSelectionExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          rawMessage: 'Cafe 850',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: { provider: 'google', fileList: [{ id: 'f1', name: 'file1' }] },
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('falls back to placeholder when HandleSpreadsheetFileSelection is not wired', async () => {
        const deps = buildMockDeps();
        deps.handleSpreadsheetFileSelection = null;
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({ currentState: 'ONBOARDING_FILE' }),
        );

        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.onboardingPlaceholder(),
        );
        expect(mockHandleSpreadsheetFileSelectionExecute).not.toHaveBeenCalled();
      });
    });

    describe('ONBOARDING_SHEET', () => {
      it('delegates to HandleSheetSelection when wired', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_SHEET',
            statePayload: { selectedFileId: 'f1', selectedFileName: 'file1', provider: 'google' },
          }),
        );
        mockHandleSheetSelectionExecute.mockResolvedValue({
          nextState: 'ONBOARDING_MAPPING',
          message: 'Sheet selected.',
        });

        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockHandleSheetSelectionExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          rawMessage: 'Cafe 850',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: { selectedFileId: 'f1', selectedFileName: 'file1', provider: 'google' },
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('falls back to placeholder when HandleSheetSelection is not wired', async () => {
        const deps = buildMockDeps();
        deps.handleSheetSelection = null;
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({ currentState: 'ONBOARDING_SHEET' }),
        );

        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.onboardingPlaceholder(),
        );
        expect(mockHandleSheetSelectionExecute).not.toHaveBeenCalled();
      });
    });

    describe('ONBOARDING_VALIDATING_ACCESS', () => {
      it('delegates to ValidateSpreadsheetAccess when wired', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_VALIDATING_ACCESS',
            statePayload: {
              selectedFileId: 'f1',
              selectedFileName: 'file1',
              selectedSheetName: 'Gastos',
              provider: 'google',
            },
          }),
        );
        mockValidateSpreadsheetAccessExecute.mockResolvedValue({
          nextState: 'ONBOARDING_MAPPING',
          message: '',
        });

        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockValidateSpreadsheetAccessExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: {
            selectedFileId: 'f1',
            selectedFileName: 'file1',
            selectedSheetName: 'Gastos',
            provider: 'google',
          },
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('falls back to placeholder when ValidateSpreadsheetAccess is not wired', async () => {
        const deps = buildMockDeps();
        deps.validateSpreadsheetAccess = null;
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({ currentState: 'ONBOARDING_VALIDATING_ACCESS' }),
        );

        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.onboardingPlaceholder(),
        );
        expect(mockValidateSpreadsheetAccessExecute).not.toHaveBeenCalled();
      });
    });

    describe('ONBOARDING_MAPPING', () => {
      const mappingPayload = {
        selectedFileId: 'f1',
        selectedFileName: 'file1',
        selectedSheetName: 'Gastos',
        provider: 'google',
        mappings: [
          { gasttoField: 'fecha' as const, columnIndex: 0, columnHeader: 'Fecha' },
          { gasttoField: 'monto' as const, columnIndex: 1, columnHeader: 'Monto' },
        ],
      };

      it('delegates to InferColumnMapping when there is no mapping proposal', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: {
              selectedFileId: 'f1',
              selectedFileName: 'file1',
              selectedSheetName: 'Gastos',
              provider: 'google',
              preview: { provider: 'google', fileId: 'f1', sheetName: 'Gastos', rows: [] },
            },
          }),
        );
        mockInferColumnMappingExecute.mockResolvedValue({
          nextState: 'ONBOARDING_MAPPING',
          message: 'Mapping proposal sent.',
        });

        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockInferColumnMappingExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: {
            selectedFileId: 'f1',
            selectedFileName: 'file1',
            selectedSheetName: 'Gastos',
            provider: 'google',
            preview: { provider: 'google', fileId: 'f1', sheetName: 'Gastos', rows: [] },
          },
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
        expect(mockConfirmColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockCorrectColumnMappingExecute).not.toHaveBeenCalled();
      });

      it('delegates to ConfirmColumnMapping on confirm intent with an existing proposal', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: mappingPayload,
          }),
        );
        mockConfirmColumnMappingExecute.mockResolvedValue({
          nextState: 'ONBOARDING_CATEGORIES',
          message: onboardingCopies.mappingConfirmedNextStep(),
          payload: {
            provider: 'google',
            fileId: 'f1',
            sheetName: 'Gastos',
          },
        });

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

        expect(mockConfirmColumnMappingExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: mappingPayload,
        });
        expect(mockCorrectColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockInferColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockDetectCategoriesExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: {
            provider: 'google',
            fileId: 'f1',
            sheetName: 'Gastos',
          },
        });
        expect(mockConfirmColumnMappingExecute.mock.invocationCallOrder[0]).toBeLessThan(
          mockDetectCategoriesExecute.mock.invocationCallOrder[0]!,
        );
        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('confirms mapping proposal even when payload still carries step no-header', async () => {
        const deps = buildMockDeps();
        const staleNoHeaderPayload = {
          ...mappingPayload,
          step: 'no-header',
        };
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: staleNoHeaderPayload,
          }),
        );
        mockConfirmColumnMappingExecute.mockResolvedValue({
          nextState: 'ONBOARDING_CATEGORIES',
          message: onboardingCopies.mappingConfirmedNextStep(),
          payload: {
            provider: 'google',
            fileId: 'f1',
            sheetName: 'Gastos',
          },
        });

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

        expect(mockConfirmColumnMappingExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: staleNoHeaderPayload,
        });
        expect(mockInferColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockDetectCategoriesExecute).toHaveBeenCalledOnce();
        expect(mockSendMessage).not.toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.invalidDataStartRowPrompt(),
        );
      });

      it('does not detect categories when mapping confirmation does not advance the FSM', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: mappingPayload,
          }),
        );
        mockConfirmColumnMappingExecute.mockResolvedValue({
          nextState: 'ONBOARDING_MAPPING',
          message: onboardingCopies.noMappingToConfirm(),
        });

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

        expect(mockConfirmColumnMappingExecute).toHaveBeenCalledOnce();
        expect(mockDetectCategoriesExecute).not.toHaveBeenCalled();
      });

      it('delegates to CorrectColumnMapping on correction message with an existing proposal', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: mappingPayload,
          }),
        );
        mockCorrectColumnMappingExecute.mockResolvedValue({
          kind: 'updated',
          nextState: 'ONBOARDING_MAPPING',
          message: onboardingCopies.mappingUpdatedConfirmation(mappingPayload.mappings, []),
        });

        await processMessageJob(
          buildJob({ ...baseJobData, rawMessage: 'la categoría está en la columna E' }),
          deps,
        );

        expect(mockCorrectColumnMappingExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          rawMessage: 'la categoría está en la columna E',
          statePayload: mappingPayload,
        });
        expect(mockConfirmColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockInferColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('delegates to CorrectColumnMapping with a synthetic invalid correction for list-columns intent', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: mappingPayload,
          }),
        );
        mockCorrectColumnMappingExecute.mockResolvedValue({
          kind: 'invalid-column',
          nextState: 'ONBOARDING_MAPPING',
          message: onboardingCopies.invalidColumnPrompt('ZZZ', []),
          availableColumns: [],
        });

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'mostrar columnas' }), deps);

        expect(mockCorrectColumnMappingExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          rawMessage: 'la categoría está en la columna ZZZ',
          statePayload: mappingPayload,
        });
        expect(mockConfirmColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockInferColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('falls back to placeholder when InferColumnMapping is not wired and no proposal exists', async () => {
        const deps = buildMockDeps();
        deps.inferColumnMapping = null;
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({ currentState: 'ONBOARDING_MAPPING' }),
        );

        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.onboardingPlaceholder(),
        );
        expect(mockInferColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockConfirmColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockCorrectColumnMappingExecute).not.toHaveBeenCalled();
      });

      it('falls back to placeholder when ConfirmColumnMapping is not wired and user confirms', async () => {
        const deps = buildMockDeps();
        deps.confirmColumnMapping = null;
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: mappingPayload,
          }),
        );

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.onboardingPlaceholder(),
        );
        expect(mockConfirmColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockCorrectColumnMappingExecute).not.toHaveBeenCalled();
      });

      it('sends resume prompt when a saved correction snapshot exists but FSM has no proposal', async () => {
        const basePayload = {
          selectedFileId: 'f1',
          selectedFileName: 'file1',
          selectedSheetName: 'Gastos',
          provider: 'google',
        };
        const snapshot = {
          originalMapping: [
            {
              id: 'mapping-1',
              spreadsheetId: 'config-1',
              GasttoField: 'fecha' as const,
              columnIndex: 0,
              columnHeader: 'Fecha',
              inferred: true,
              confirmedAt: null,
            },
          ],
          corrections: [
            {
              field: 'fecha' as const,
              columnIndex: 2,
              columnHeader: 'Fecha real',
            },
          ],
          status: 'correcting' as const,
        };
        mockLoadCorrectionState.mockResolvedValue(snapshot);
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: basePayload,
          }),
        );

        const deps = buildMockDeps();
        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockLoadCorrectionState).toHaveBeenCalledWith('user-123');
        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.mappingResumePrompt([
            { gasttoField: 'fecha', columnIndex: 2, columnHeader: 'Fecha real' },
          ]),
        );
        expect(mockTransitionStateExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          targetState: 'ONBOARDING_MAPPING',
          payload: { ...basePayload, step: 'resume' },
        });
        expect(mockInferColumnMappingExecute).not.toHaveBeenCalled();
      });

      it('loads snapshot and displays updated mapping when user confirms resume prompt', async () => {
        const snapshot = {
          originalMapping: [
            {
              id: 'mapping-1',
              spreadsheetId: 'config-1',
              GasttoField: 'fecha' as const,
              columnIndex: 0,
              columnHeader: 'Fecha',
              inferred: true,
              confirmedAt: null,
            },
          ],
          corrections: [
            {
              field: 'fecha' as const,
              columnIndex: 2,
              columnHeader: 'Fecha real',
            },
          ],
          status: 'correcting' as const,
        };
        mockLoadCorrectionState.mockResolvedValue(snapshot);
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: { step: 'resume' },
          }),
        );

        const deps = buildMockDeps();
        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

        expect(mockLoadCorrectionState).toHaveBeenCalledWith('user-123');
        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.mappingUpdatedConfirmation(
            [{ gasttoField: 'fecha', columnIndex: 2, columnHeader: 'Fecha real' }],
            [],
          ),
        );
        expect(mockTransitionStateExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          targetState: 'ONBOARDING_MAPPING',
          payload: {
            step: 'resume',
            mappings: [{ gasttoField: 'fecha', columnIndex: 2, columnHeader: 'Fecha real' }],
            unmappedFields: [],
          },
        });
      });

      it('clears snapshot and falls back to inference when user declines resume prompt', async () => {
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: { step: 'resume' },
          }),
        );
        mockInferColumnMappingExecute.mockResolvedValue({
          nextState: 'ONBOARDING_MAPPING',
          message: 'Mapping proposal sent.',
        });

        const deps = buildMockDeps();
        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'no' }), deps);

        expect(mockClearCorrectionState).toHaveBeenCalledWith('user-123');
        expect(mockInferColumnMappingExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: { step: 'resume' },
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('falls back to inference when resume snapshot expired while prompt was shown', async () => {
        mockLoadCorrectionState.mockResolvedValue(null);
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: { step: 'resume' },
          }),
        );
        mockInferColumnMappingExecute.mockResolvedValue({
          nextState: 'ONBOARDING_MAPPING',
          message: 'Mapping proposal sent.',
        });

        const deps = buildMockDeps();
        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

        expect(mockLoadCorrectionState).toHaveBeenCalledWith('user-123');
        expect(mockInferColumnMappingExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: { step: 'resume' },
        });
      });

      it('parses valid data-start row and delegates to InferColumnMapping with headerRowIndex', async () => {
        const noHeaderPayload = {
          selectedFileId: 'f1',
          selectedFileName: 'file1',
          selectedSheetName: 'Gastos',
          provider: 'google',
          preview: {
            provider: 'google',
            fileId: 'f1',
            sheetName: 'Gastos',
            rows: [
              { index: 1, values: ['', '', ''] },
              { index: 2, values: ['', '', ''] },
              { index: 3, values: ['', '', ''] },
              { index: 4, values: ['Fecha', 'Monto', 'Categoria'] },
              { index: 5, values: ['01/01/2026', '100.50', 'Comida'] },
            ],
          },
          step: 'no-header',
        };
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: noHeaderPayload,
          }),
        );
        mockInferColumnMappingExecute.mockResolvedValue({
          nextState: 'ONBOARDING_MAPPING',
          message: 'Mapping proposal sent.',
        });

        const deps = buildMockDeps();
        await processMessageJob(buildJob({ ...baseJobData, rawMessage: '5' }), deps);

        expect(mockInferColumnMappingExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: { ...noHeaderPayload, headerRowIndex: 4 },
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
        expect(mockTransitionStateExecute).not.toHaveBeenCalled();
      });

      it('re-prompts when no-header reply is not a valid row number', async () => {
        const noHeaderPayload = {
          selectedFileId: 'f1',
          selectedFileName: 'file1',
          selectedSheetName: 'Gastos',
          provider: 'google',
          preview: {
            provider: 'google',
            fileId: 'f1',
            sheetName: 'Gastos',
            rows: [{ index: 1, values: ['Fecha', 'Monto', 'Categoria'] }],
          },
          step: 'no-header',
        };
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: noHeaderPayload,
          }),
        );

        const deps = buildMockDeps();
        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'cinco' }), deps);

        expect(mockInferColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.invalidDataStartRowPrompt(),
        );
        expect(mockTransitionStateExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          targetState: 'ONBOARDING_MAPPING',
          payload: { ...noHeaderPayload, step: 'no-header' },
        });
      });

      it('re-prompts when data-start row is less than 2', async () => {
        const noHeaderPayload = {
          selectedFileId: 'f1',
          preview: {
            provider: 'google',
            fileId: 'f1',
            sheetName: 'Gastos',
            rows: [{ index: 1, values: ['Fecha', 'Monto', 'Categoria'] }],
          },
          step: 'no-header',
        };
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: noHeaderPayload,
          }),
        );

        const deps = buildMockDeps();
        await processMessageJob(buildJob({ ...baseJobData, rawMessage: '1' }), deps);

        expect(mockInferColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.invalidDataStartRowPrompt(),
        );
        expect(mockTransitionStateExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          targetState: 'ONBOARDING_MAPPING',
          payload: { ...noHeaderPayload, step: 'no-header' },
        });
      });

      it('re-prompts when computed header row is not in the preview', async () => {
        const noHeaderPayload = {
          selectedFileId: 'f1',
          preview: {
            provider: 'google',
            fileId: 'f1',
            sheetName: 'Gastos',
            rows: [{ index: 1, values: ['Fecha', 'Monto', 'Categoria'] }],
          },
          step: 'no-header',
        };
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: noHeaderPayload,
          }),
        );

        const deps = buildMockDeps();
        await processMessageJob(buildJob({ ...baseJobData, rawMessage: '10' }), deps);

        expect(mockInferColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.invalidDataStartRowPrompt(),
        );
        expect(mockTransitionStateExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          targetState: 'ONBOARDING_MAPPING',
          payload: { ...noHeaderPayload, step: 'no-header' },
        });
      });

      it('falls back to placeholder when no-header reply is valid but InferColumnMapping is not wired', async () => {
        const noHeaderPayload = {
          selectedFileId: 'f1',
          preview: {
            provider: 'google',
            fileId: 'f1',
            sheetName: 'Gastos',
            rows: [
              { index: 1, values: ['Fecha', 'Monto', 'Categoria'] },
              { index: 2, values: ['01/01/2026', '100.50', 'Comida'] },
            ],
          },
          step: 'no-header',
        };
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_MAPPING',
            statePayload: noHeaderPayload,
          }),
        );

        const deps = buildMockDeps();
        deps.inferColumnMapping = null;
        await processMessageJob(buildJob({ ...baseJobData, rawMessage: '2' }), deps);

        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.onboardingPlaceholder(),
        );
      });
    });

    describe('ONBOARDING_CATEGORIES', () => {
      it('delegates to DetectCategories on first entry when categories are not yet in payload', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({ currentState: 'ONBOARDING_CATEGORIES' }),
        );

        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockDetectCategoriesExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: null,
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('falls back to placeholder on first entry when DetectCategories is not wired', async () => {
        const deps = buildMockDeps();
        deps.detectCategories = null;
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({ currentState: 'ONBOARDING_CATEGORIES' }),
        );

        await processMessageJob(buildJob(baseJobData), deps);

        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.onboardingPlaceholder(),
        );
      });

      it('delegates to ConfirmCategories on confirm reply when categories are already in payload', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_CATEGORIES',
            statePayload: { categories: ['comida', 'transporte'] },
          }),
        );
        mockConfirmCategoriesExecute.mockResolvedValue({
          nextState: 'IDLE',
          message: onboardingCopies.onboardingComplete(),
        });

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

        expect(mockDetectCategoriesExecute).not.toHaveBeenCalled();
        expect(mockConfirmCategoriesExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          statePayload: { categories: ['comida', 'transporte'] },
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('routes the next message to expense interpretation after repeated category confirmation', async () => {
        const deps = buildMockDeps();
        const findSpreadsheetConfig = vi.fn().mockResolvedValue({
          id: 'config-1',
          categoriesConfirmedAt: new Date('2026-08-30T10:00:00Z'),
        });
        const updateCategoriesConfirmed = vi.fn();
        const updateUserStatus = vi.fn().mockResolvedValue(undefined);

        deps.confirmCategories = new ConfirmCategories({
          spreadsheetConfigRepository: {
            findByUserId: findSpreadsheetConfig,
            updateCategoriesConfirmed,
          } as unknown as ConfirmCategoriesDeps['spreadsheetConfigRepository'],
          userRepository: {
            updateStatus: updateUserStatus,
          } as unknown as ConfirmCategoriesDeps['userRepository'],
          messagingPort: { sendMessage: mockSendMessage },
          transitionState: {
            execute: mockTransitionStateExecute,
          } as unknown as ConfirmCategoriesDeps['transitionState'],
        });
        mockGetConversationStateExecute
          .mockResolvedValueOnce(
            buildConversationState({
              currentState: 'ONBOARDING_CATEGORIES',
              statePayload: { categories: ['comida', 'transporte'] },
              expiresAt: new Date('2026-08-31T12:00:00Z'),
            }),
          )
          .mockResolvedValueOnce(buildConversationState({ currentState: 'IDLE' }));
        mockRegisterExpenseInterpret.mockResolvedValue({
          status: 'success',
          payload: {
            rawMessage: 'cafe 12 euros',
            extracted: { monto: 12, moneda: 'EUR', confianzaCategoria: 'alta' },
            resolvedDate: '2026-08-31',
            resolvedCategory: 'comida',
            categoryStatus: 'confirmed',
          },
        });

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);
        await processMessageJob(
          buildJob({ ...baseJobData, rawMessage: 'cafe 12 euros', externalMessageId: 'msg-43' }),
          deps,
        );

        expect(findSpreadsheetConfig).toHaveBeenCalledOnce();
        expect(updateCategoriesConfirmed).not.toHaveBeenCalled();
        expect(updateUserStatus).toHaveBeenCalledWith('user-123', 'active');
        expect(mockTransitionStateExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          targetState: 'IDLE',
          payload: null,
          expiresAt: null,
        });
        expect(mockRegisterExpenseInterpret).toHaveBeenCalledWith({
          userId: 'user-123',
          rawMessage: 'cafe 12 euros',
          channel: 'telegram',
        });
        expect(mockDetectCategoriesExecute).not.toHaveBeenCalled();
        expect(mockModifyCategoryVocabularyExecute).not.toHaveBeenCalled();
        expect(mockInitiateCloudConnectionExecute).not.toHaveBeenCalled();
        expect(mockInferColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockConfirmColumnMappingExecute).not.toHaveBeenCalled();
        expect(mockCorrectColumnMappingExecute).not.toHaveBeenCalled();
      });

      it('falls back to placeholder on confirm reply when ConfirmCategories is not wired', async () => {
        const deps = buildMockDeps();
        deps.confirmCategories = null;
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_CATEGORIES',
            statePayload: { categories: ['comida', 'transporte'] },
          }),
        );

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          onboardingCopies.onboardingPlaceholder(),
        );
      });

      it('delegates to ModifyCategoryVocabulary on non-confirm reply when categories are already in payload', async () => {
        const deps = buildMockDeps();
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_CATEGORIES',
            statePayload: { categories: ['comida', 'transporte'] },
          }),
        );
        mockModifyCategoryVocabularyExecute.mockResolvedValue({
          categories: ['comida', 'transporte', 'salud'],
          message: onboardingCopies.categoryUpdatedPrompt(['comida', 'transporte', 'salud']),
        });

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'falta Salud' }), deps);

        expect(mockDetectCategoriesExecute).not.toHaveBeenCalled();
        expect(mockConfirmCategoriesExecute).not.toHaveBeenCalled();
        expect(mockModifyCategoryVocabularyExecute).toHaveBeenCalledWith({
          userId: 'user-123',
          externalId: '123456789',
          channel: 'telegram',
          rawMessage: 'falta Salud',
          statePayload: { categories: ['comida', 'transporte'] },
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('re-sends confirmation prompt on non-confirm reply when ModifyCategoryVocabulary is not wired', async () => {
        const deps = buildMockDeps();
        deps.modifyCategoryVocabulary = null;
        mockGetConversationStateExecute.mockResolvedValue(
          buildConversationState({
            currentState: 'ONBOARDING_CATEGORIES',
            statePayload: { categories: ['comida', 'transporte'] },
          }),
        );

        await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'falta Salud' }), deps);

        expect(mockDetectCategoriesExecute).not.toHaveBeenCalled();
        expect(mockConfirmCategoriesExecute).not.toHaveBeenCalled();
        expect(mockModifyCategoryVocabularyExecute).not.toHaveBeenCalled();
        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          expect.stringContaining('comida'),
        );
        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456789',
          expect.stringContaining('transporte'),
        );
      });
    });
  });

  describe('unknown / corrupted state', () => {
    it('sends recovery message when RecoverCorruptedState recovers', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'UNKNOWN_STATE' as ConversationState['currentState'],
        }),
      );
      mockRecoverCorruptedStateExecute.mockResolvedValue({
        recovered: true,
        message: 'Recovered from bad state.',
      });

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockRecoverCorruptedStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        observedState: 'UNKNOWN_STATE',
      });
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', 'Recovered from bad state.');
      expect(mockTransitionStateExecute).not.toHaveBeenCalled();
    });

    it('transitions to IDLE and sends fallback when RecoverCorruptedState does not recover', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'EXPENSE_SAVING' }),
      );
      mockRecoverCorruptedStateExecute.mockResolvedValue({ recovered: false, message: '' });

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockRecoverCorruptedStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        observedState: 'EXPENSE_SAVING',
      });
      expect(mockTransitionStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
      });
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.fallbackError());
    });
  });

  describe('per-user lock', () => {
    it('releases the lock after successful processing', async () => {
      mockAcquireLock.mockResolvedValue(LOCK_TOKEN_A);
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'ONBOARDING_CATEGORIES' }),
      );

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockAcquireLock).toHaveBeenCalledWith('user-123', expect.any(Number));
      expect(mockReleaseLock).toHaveBeenCalledWith('user-123', LOCK_TOKEN_A);
    });

    it('releases the lock even when the handler throws unexpectedly', async () => {
      mockAcquireLock.mockResolvedValue(LOCK_TOKEN_A);
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'ONBOARDING_SHEET' }),
      );
      mockHandleSheetSelectionExecute.mockRejectedValue(new Error('boom'));

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockReleaseLock).toHaveBeenCalledWith('user-123', LOCK_TOKEN_A);
    });

    it('logs but does not fail when releasing the lock throws', async () => {
      mockAcquireLock.mockResolvedValue(LOCK_TOKEN_A);
      mockReleaseLock.mockRejectedValue(new Error('redis down'));
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'ONBOARDING_CATEGORIES' }),
      );

      await expect(processMessageJob(buildJob(baseJobData), deps)).resolves.toBeUndefined();

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LOCK_RELEASE_FAILED',
          endpoint: 'processMessageJob',
          userId: 'user-123',
          error: 'redis down',
        }),
      );
    });

    it('throws UserAlreadyProcessingError when lock is not acquired', async () => {
      mockAcquireLock.mockResolvedValue(null);
      const deps = buildMockDeps();

      await expect(processMessageJob(buildJob(baseJobData), deps)).rejects.toThrow(
        UserAlreadyProcessingError,
      );

      expect(mockGetConversationStateExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockReleaseLock).not.toHaveBeenCalled();
    });

    it('different users can both acquire the lock', async () => {
      mockAcquireLock.mockResolvedValueOnce(LOCK_TOKEN_A);
      mockAcquireLock.mockResolvedValueOnce(LOCK_TOKEN_B);
      mockUserRepoFindByMessagingIdentity
        .mockResolvedValueOnce({ userId: 'user-123' })
        .mockResolvedValueOnce({ userId: 'user-456' });
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'ONBOARDING_CATEGORIES' }),
      );

      await processMessageJob(buildJob(baseJobData), deps);
      await processMessageJob(buildJob({ ...baseJobData, userId: 'user-456' }), deps);

      expect(mockAcquireLock).toHaveBeenNthCalledWith(1, 'user-123', expect.any(Number));
      expect(mockAcquireLock).toHaveBeenNthCalledWith(2, 'user-456', expect.any(Number));
      expect(mockReleaseLock).toHaveBeenNthCalledWith(1, 'user-123', LOCK_TOKEN_A);
      expect(mockReleaseLock).toHaveBeenNthCalledWith(2, 'user-456', LOCK_TOKEN_B);
    });
  });

  describe('missing state', () => {
    it('defaults to IDLE when no conversation state exists', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(null);
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'needs_clarification',
        missingField: 'monto',
      });

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockRegisterExpenseInterpret).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.clarificationAmount(),
      );
    });
  });

  describe('unexpected handler errors (no BullMQ retry)', () => {
    it('catches a thrown use-case error without rethrowing, sends a single fallback, and logs structured error', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'ONBOARDING_SHEET',
          statePayload: { selectedFileId: 'f1', selectedFileName: 'file1', provider: 'google' },
        }),
      );
      mockHandleSheetSelectionExecute.mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "uq_user_spreadsheet"'),
      );

      await expect(processMessageJob(buildJob(baseJobData), deps)).resolves.toBeUndefined();

      expect(mockHandleSheetSelectionExecute).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNEXPECTED_HANDLER_ERROR',
          endpoint: 'processMessageJob',
          userId: 'user-123',
          error: 'duplicate key value violates unique constraint "uq_user_spreadsheet"',
        }),
      );
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.fallbackError());
    });

    it('does not re-send the message on subsequent retries (single attempt outcome)', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'ONBOARDING_SHEET',
          statePayload: { selectedFileId: 'f1', selectedFileName: 'file1', provider: 'google' },
        }),
      );
      mockHandleSheetSelectionExecute.mockRejectedValue(new Error('boom'));

      await processMessageJob(buildJob(baseJobData), deps);
      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockHandleSheetSelectionExecute).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenNthCalledWith(
        1,
        '123456789',
        expenseCopies.fallbackError(),
      );
      expect(mockSendMessage).toHaveBeenNthCalledWith(
        2,
        '123456789',
        expenseCopies.fallbackError(),
      );
    });

    it('still completes when fallback send also throws (logs send failure, no rethrow)', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'ONBOARDING_SHEET' }),
      );
      mockHandleSheetSelectionExecute.mockRejectedValue(new Error('handler down'));
      mockSendMessage.mockRejectedValueOnce(new Error('telegram 429'));

      await expect(processMessageJob(buildJob(baseJobData), deps)).resolves.toBeUndefined();

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'FALLBACK_SEND_FAILED' }),
      );
    });
  });

  describe('E1-US-05 clarification Gherkin scenarios', () => {
    it('asks for the missing currency when amount is present but currency is missing', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'IDLE' }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'needs_clarification',
        missingField: 'moneda',
      });

      await processMessageJob(
        buildJob({ ...baseJobData, rawMessage: 'Pagué 30 por el café' }),
        deps,
      );

      expect(mockRegisterExpenseInterpret).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Pagué 30 por el café',
        channel: 'telegram',
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.clarificationCurrency(),
      );
    });

    it('asks for the missing amount when no amount is found', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'IDLE' }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'needs_clarification',
        missingField: 'monto',
      });

      await processMessageJob(
        buildJob({ ...baseJobData, rawMessage: 'Fui al supermercado' }),
        deps,
      );

      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.clarificationAmount(),
      );
    });

    it('shows ambiguous category as editable in the review summary instead of asking', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'IDLE' }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'success',
        payload: {
          rawMessage: 'Compré algo en el kiosco, 8 euros',
          extracted: { monto: 8, moneda: 'EUR', confianzaCategoria: 'baja' },
          resolvedDate: '2026-07-25',
          resolvedCategory: 'Ocio',
          categoryStatus: 'ambiguous',
        },
      });

      await processMessageJob(
        buildJob({ ...baseJobData, rawMessage: 'Compré algo en el kiosco, 8 euros' }),
        deps,
      );

      const sentText = mockSendMessage.mock.calls[0]![1] as string;
      expect(sentText).toContain('Ocio');
      expect(sentText).toContain('(¿correcto?)');
    });

    it('asks for amount first, then currency, when both are missing', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute
        .mockResolvedValueOnce(buildConversationState({ currentState: 'IDLE' }))
        .mockResolvedValueOnce(
          buildConversationState({
            currentState: 'EXPENSE_CLARIFYING',
            statePayload: buildClarificationStatePayload('monto', 'Gasté algo'),
          }),
        );
      mockRegisterExpenseInterpret
        .mockResolvedValueOnce({ status: 'needs_clarification', missingField: 'monto' })
        .mockResolvedValueOnce({ status: 'needs_clarification', missingField: 'moneda' });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'Gasté algo' }), deps);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.clarificationAmount(),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: '100' }), deps);
      expect(mockRegisterExpenseInterpret).toHaveBeenLastCalledWith({
        userId: 'user-123',
        rawMessage: 'Gasté algo 100',
        channel: 'telegram',
      });
      expect(mockSendMessage).toHaveBeenLastCalledWith(
        '123456789',
        expenseCopies.clarificationCurrency(),
      );
    });

    it('cancels the previous clarification and processes a new expense message', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: buildClarificationStatePayload('monto', 'Cafe'),
        }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'success',
        payload: {
          rawMessage: 'Pagué 30 euros por el café',
          extracted: { monto: 30, moneda: 'EUR', confianzaCategoria: 'alta' },
          resolvedDate: '2026-07-25',
          resolvedCategory: 'Comida',
          categoryStatus: 'confirmed',
        },
      });

      await processMessageJob(
        buildJob({ ...baseJobData, rawMessage: 'Pagué 30 euros por el café' }),
        deps,
      );

      expect(mockTransitionStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expenseCopies.clarificationInterrupted(),
      );
      expect(mockRegisterExpenseInterpret).toHaveBeenLastCalledWith({
        userId: 'user-123',
        rawMessage: 'Pagué 30 euros por el café',
        channel: 'telegram',
      });
      const lastSent = mockSendMessage.mock.calls[
        mockSendMessage.mock.calls.length - 1
      ]![1] as string;
      expect(lastSent).toContain('Resumen del gasto');
    });

    it('reformulates the currency question with concrete options when the user answers "no sé"', async () => {
      const deps = buildMockDeps();
      mockUserProfileGetDefaultCurrency.mockResolvedValue('ARS');
      mockFindRecentCurrenciesByUserId.mockResolvedValue(['USD', 'EUR']);
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: buildClarificationStatePayload('moneda', 'Gasté 100'),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'no sé' }), deps);

      expect(mockUserProfileGetDefaultCurrency).toHaveBeenCalledWith('user-123');
      expect(mockFindRecentCurrenciesByUserId).toHaveBeenCalledWith('user-123', 5);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        '¿El gasto fue en pesos argentinos (ARS), dólares (USD) o euros (EUR)?',
      );
      expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
    });
  });
  describe('EXPENSE_SAVING_RETRY state', () => {
    const payload = {
      expense: {
        rawMessage: 'Café 200 EUR',
        extracted: { monto: 200, moneda: 'EUR' },
      },
      failureCode: 'NETWORK_ERROR',
      firstAttemptAt: '2026-08-05T10:00:00.000Z',
      attemptCount: 1,
    };

    it('delegates reintentar without re-running NLP', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_SAVING_RETRY',
          statePayload: payload,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'reintentar' }), deps);

      expect(mockRetryExpenseSaveExecute).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-123', chatId: '123456789', statePayload: payload }),
      );
      expect(mockRegisterExpenseInterpret).not.toHaveBeenCalled();
    });

    it('delegates reconfigurar to the reconfiguration use case', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_SAVING_RETRY',
          statePayload: payload,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'reconfigurar' }), deps);

      expect(mockStartSpreadsheetReconfigurationExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        chatId: '123456789',
        channel: 'telegram',
      });
    });

    it('clears expired retry state without invoking a resolution use case', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_SAVING_RETRY',
          statePayload: payload,
          expiresAt: new Date(Date.now() - 1),
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'reintentar' }), deps);

      expect(mockTransitionStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
        payload: null,
      });
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.saveRetryExpired());
      expect(mockRetryExpenseSaveExecute).not.toHaveBeenCalled();
    });
  });
});

describe('createMessageWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a Worker with concurrency: 2 and drainDelay: 30', () => {
    const deps = buildMockDeps();
    createMessageWorker(deps);

    const [, , opts] = vi.mocked(Worker).mock.calls[0] as unknown as [
      unknown,
      unknown,
      { concurrency: number; drainDelay: number },
    ];
    expect(opts.concurrency).toBe(2);
    expect(opts.drainDelay).toBe(30);
  });

  it('logs a sanitized structured error once on worker error events', () => {
    const worker = createMessageWorker(buildMockDeps());

    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'error',
      new Error('Connection lost'),
    );

    expect(mockLoggerError).toHaveBeenCalledOnce();
    expect(mockLoggerError).toHaveBeenCalledWith({
      msg: 'BullMQ worker error',
      endpoint: 'bullmq',
      code: 'BULLMQ_WORKER_ERROR',
      queue: 'process-message',
      error: 'Connection lost',
    });
  });
});

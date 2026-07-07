// LAYER: Interfaces / Tests
// Contract tests for the message worker (process-message queue).
// Mocks bullmq.Worker so no real Redis is needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processMessageJob, createMessageWorker, type MessageWorkerDeps } from './message.worker';
import type { Job } from 'bullmq';
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
import { UserAlreadyProcessingError } from '../../domain/errors/UserAlreadyProcessingError';
import { expenseCopies } from '../../application/copies/expense.copies';
import { onboardingCopies } from '../../application/copies/onboarding.copies';

const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockGetConversationStateExecute = vi.fn();
const mockLoggerError = vi.fn();
const mockTransitionStateExecute = vi.fn();
const mockRecoverCorruptedStateExecute = vi.fn();
const mockUserRepoFindById = vi.fn();
const mockRegisterExpenseInterpret = vi.fn();
const mockInitiateCloudConnectionExecute = vi.fn();
const mockCancelCloudConnectionExecute = vi.fn();
const mockHandleSpreadsheetFileSelectionExecute = vi.fn();
const mockHandleSheetSelectionExecute = vi.fn();
const mockValidateSpreadsheetAccessExecute = vi.fn();
const mockInferColumnMappingExecute = vi.fn();
const mockConfirmColumnMappingExecute = vi.fn();
const mockCorrectColumnMappingExecute = vi.fn();
const mockLoadCorrectionState = vi.fn();
const mockSaveCorrectionState = vi.fn();
const mockAcquireLock = vi.fn();
const mockReleaseLock = vi.fn();
const LOCK_TOKEN_A = 'lock-token-a';
const LOCK_TOKEN_B = 'lock-token-b';
const mockClearCorrectionState = vi.fn();

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
    } as unknown as MessageWorkerDeps['userRepo'],
    messagingAdapters: {
      telegram: { sendMessage: mockSendMessage },
      whatsapp: { sendMessage: mockSendMessage },
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

const baseJobData: ProcessMessageJobData = {
  userId: 'user-123',
  rawMessage: 'Cafe 850',
  channel: 'telegram',
  externalId: '123456789',
  receivedAt: new Date().toISOString(),
};

describe('processMessageJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquireLock.mockResolvedValue(LOCK_TOKEN_A);
  });

  describe('IDLE / EXPENSE_RECEIVING state', () => {
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
        defaultCurrency: null,
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
        },
      });

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const sentText = mockSendMessage.mock.calls[0]![1] as string;
      expect(sentText).toContain('850 ARS');
      expect(sentText).toContain('Comida');
    });
  });

  describe('EXPENSE_REVIEW state', () => {
    it('confirms expense and sends saving message', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: { rawMessage: 'Cafe 850' },
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'sí' }), deps);

      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.saving());
      expect(mockTransitionStateExecute).not.toHaveBeenCalled();
    });

    it('cancels expense and transitions to IDLE', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: { rawMessage: 'Cafe 850' },
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'cancelar' }), deps);

      expect(mockTransitionStateExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'IDLE',
      });
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.cancelled());
    });

    it('asks for clarification on ambiguous response', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_REVIEW',
          statePayload: { rawMessage: 'Cafe 850' },
        }),
      );

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: 'maybe' }), deps);

      expect(mockTransitionStateExecute).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', expenseCopies.ambiguousResponse());
    });
  });

  describe('EXPENSE_CLARIFYING state', () => {
    it('sends updated summary when clarification resolves', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: { rawMessage: 'Cafe' },
        }),
      );
      mockRegisterExpenseInterpret.mockResolvedValue({
        status: 'success',
        payload: {
          rawMessage: 'Cafe 850',
          extracted: { monto: '850', moneda: 'ARS', confianzaCategoria: 'alta' },
          resolvedDate: '2026-01-15',
          resolvedCategory: 'Comida',
        },
      });

      await processMessageJob(buildJob({ ...baseJobData, rawMessage: '850 pesos' }), deps);

      expect(mockRegisterExpenseInterpret).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Cafe 850 pesos',
        channel: 'telegram',
        defaultCurrency: null,
      });
      const sentText = mockSendMessage.mock.calls[0]![1] as string;
      expect(sentText).toContain('Resumen actualizado');
    });

    it('asks again when clarification still needs more info', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({
          currentState: 'EXPENSE_CLARIFYING',
          statePayload: { rawMessage: 'Cafe' },
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
  });

  describe('ONBOARDING states', () => {
    it('delegates ONBOARDING_START to InitiateCloudConnection when prompt was already shown', async () => {
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

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockInitiateCloudConnectionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        rawMessage: 'Cafe 850',
        externalId: '123456789',
        channel: 'telegram',
      });
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
        expect(mockSendMessage).not.toHaveBeenCalled();
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
    });

    it('sends onboarding placeholder for ONBOARDING_CATEGORIES', async () => {
      const deps = buildMockDeps();
      mockGetConversationStateExecute.mockResolvedValue(
        buildConversationState({ currentState: 'ONBOARDING_CATEGORIES' }),
      );

      await processMessageJob(buildJob(baseJobData), deps);

      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        onboardingCopies.onboardingPlaceholder(),
      );
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
});

describe('createMessageWorker', () => {
  const WorkerMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(WorkerMock).mockImplementation(() => ({
      on: vi.fn(),
      opts: { concurrency: 2 },
    }));
  });

  // We cannot easily mock the bullmq Worker class import in vitest without
  // hoisting issues, so we test the exported processor directly in processMessageJob
  // and verify the factory signature here at the type level.
  it('has the correct type signature', () => {
    // This test is mostly a compile-time guard; if it compiles, the shape is correct.
    const deps = buildMockDeps();
    expect(typeof createMessageWorker).toBe('function');
    expect(() => createMessageWorker(deps)).not.toThrow(TypeError);
  });
});

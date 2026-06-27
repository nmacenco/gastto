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
import { expenseCopies } from '../../application/copies/expense.copies';
import { onboardingCopies } from '../../application/copies/onboarding.copies';

const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockGetConversationStateExecute = vi.fn();
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

function buildMockDeps(): MessageWorkerDeps {
  return {
    redis: {} as unknown as MessageWorkerDeps['redis'],
    logger: {} as unknown as MessageWorkerDeps['logger'],
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
      it('delegates to InferColumnMapping when wired', async () => {
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
      });

      it('falls back to placeholder when InferColumnMapping is not wired', async () => {
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

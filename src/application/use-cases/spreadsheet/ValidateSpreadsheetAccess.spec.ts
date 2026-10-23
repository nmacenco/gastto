// LAYER: Application / Tests
// Unit tests for ValidateSpreadsheetAccess use case.
// Mocks ValidateSpreadsheetAccessPortFactory, OAuthAccessTokenProvider,
// TransitionConversationState, MessagingOutputPort,
// and ISpreadsheetConfigRepository.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ValidateSpreadsheetAccess,
  type ValidateSpreadsheetAccessDeps,
  type ValidateSpreadsheetAccessInput,
} from './ValidateSpreadsheetAccess';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { SpreadsheetPreview } from '../../../domain/entities/SpreadsheetPreview';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

const mockValidateAccess = vi.fn();
const mockTransitionExecute = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockGetValidAccessToken = vi.fn();
const mockForceRefreshAccessToken = vi.fn();
const mockFindByUserId = vi.fn();
const mockUpdateAccessVerified = vi.fn();
const mockCreatePort = vi.fn().mockReturnValue({
  validateSpreadsheetAccess: mockValidateAccess,
});
const mockInferColumnMapping = vi.fn().mockResolvedValue({
  nextState: 'ONBOARDING_MAPPING',
  message: '',
});
const mockLoggerError = vi.fn();

function buildMockDeps(
  overrides: Partial<ValidateSpreadsheetAccessDeps> = {},
): ValidateSpreadsheetAccessDeps {
  return {
    validateSpreadsheetAccessPortFactory: {
      create: mockCreatePort,
    },
    oauthAccessTokenService: {
      getValidAccessToken: mockGetValidAccessToken,
      forceRefreshAccessToken: mockForceRefreshAccessToken,
    },
    transitionState: {
      execute: mockTransitionExecute,
    } as unknown as TransitionConversationState,
    messagingPort: { sendMessage: mockSendMessage },
    spreadsheetConfigRepository: {
      findByUserId: mockFindByUserId,
      updateAccessVerified: mockUpdateAccessVerified,
    } as unknown as ValidateSpreadsheetAccessDeps['spreadsheetConfigRepository'],
    inferColumnMapping: {
      execute: mockInferColumnMapping,
    } as unknown as ValidateSpreadsheetAccessDeps['inferColumnMapping'],
    logger: { error: mockLoggerError } as unknown as ValidateSpreadsheetAccessDeps['logger'],
    ...overrides,
  };
}

const baseInput: ValidateSpreadsheetAccessInput = {
  userId: 'user-123',
  externalId: '987654321',
  channel: 'telegram',
  statePayload: null,
};

const mockPreview = new SpreadsheetPreview({
  provider: 'google',
  fileId: 'file-123',
  sheetName: 'Gastos',
  rows: [{ index: 1, values: ['Fecha', 'Concepto', 'Monto'] }],
});

const mockStatePayload = {
  selectedFileId: 'file-123',
  selectedFileName: 'Mi Planilla',
  selectedSheetName: 'Gastos',
  provider: 'google',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetValidAccessToken.mockResolvedValue({
    accessToken: 'decrypted-access-token',
    expiresAt: new Date(Date.now() + 3600_000),
    refreshed: false,
  });
  mockForceRefreshAccessToken.mockResolvedValue({
    accessToken: 'refreshed-access-token',
    expiresAt: new Date(Date.now() + 3600_000),
    refreshed: true,
  });
  mockFindByUserId.mockResolvedValue({
    id: 'config-1',
    userId: 'user-123',
    provider: 'google',
    fileId: 'file-123',
    fileName: 'Mi Planilla',
    sheetName: 'Gastos',
    accessVerifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockUpdateAccessVerified.mockResolvedValue(undefined);
});

describe('ValidateSpreadsheetAccess', () => {
  describe('success path', () => {
    it('updates accessVerifiedAt, transitions to ONBOARDING_MAPPING, and sends no message', async () => {
      mockValidateAccess.mockResolvedValue({ kind: 'success', preview: mockPreview });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockCreatePort).toHaveBeenCalledWith('google', 'decrypted-access-token');
      expect(mockValidateAccess).toHaveBeenCalledWith('file-123', 'Gastos');
      expect(mockUpdateAccessVerified).toHaveBeenCalledWith('config-1');
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_MAPPING',
        payload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
          preview: {
            provider: 'google',
            fileId: 'file-123',
            sheetName: 'Gastos',
            rows: [{ index: 1, values: ['Fecha', 'Concepto', 'Monto'] }],
          },
        },
      });
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
      expect(result.message).toBe('');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('read-only branch', () => {
    it('sends read-only warning and stays in ONBOARDING_VALIDATING_ACCESS', async () => {
      mockValidateAccess.mockResolvedValue({ kind: 'read-only', preview: mockPreview });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith('987654321', onboardingCopies.readOnlyWarning());
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
      expect(result.message).toBe(onboardingCopies.readOnlyWarning());
      expect(mockTransitionExecute).not.toHaveBeenCalled();
      expect(mockUpdateAccessVerified).not.toHaveBeenCalled();
    });
  });

  describe('empty-sheet branch', () => {
    it('sends empty-sheet confirm, transitions to ONBOARDING_SHEET with step and sheetList', async () => {
      mockValidateAccess.mockResolvedValue({ kind: 'empty-sheet' });

      const sheetList = [{ name: 'Gastos', index: 0 }];
      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: { ...mockStatePayload, sheetList },
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.emptySheetConfirm('Gastos'),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_SHEET',
        payload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
          step: 'empty-sheet-confirm',
          sheetList,
        },
      });
      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(mockUpdateAccessVerified).not.toHaveBeenCalled();
    });

    it('omits sheetList from payload when not present in statePayload', async () => {
      mockValidateAccess.mockResolvedValue({ kind: 'empty-sheet' });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_SHEET',
        payload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
          step: 'empty-sheet-confirm',
        },
      });
      expect(result.nextState).toBe('ONBOARDING_SHEET');
    });
  });

  describe('access-error branch', () => {
    it('keeps onboarding state on a retryable network error without reconnecting', async () => {
      mockValidateAccess.mockResolvedValue({
        kind: 'access-error',
        errorType: 'network-error',
        retryable: true,
      });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockValidateAccess).toHaveBeenCalledTimes(1);
      expect(mockUpdateAccessVerified).not.toHaveBeenCalled();
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.sheetDiscoveryFailed(),
      );
      expect(mockTransitionExecute).not.toHaveBeenCalled();
    });

    it('forces one refresh for authorization failure and reconnects if the replay also fails', async () => {
      mockValidateAccess
        .mockResolvedValueOnce({
          kind: 'access-error',
          errorType: 'permission-denied',
          retryable: false,
        })
        .mockResolvedValueOnce({
          kind: 'access-error',
          errorType: 'permission-denied',
          retryable: false,
        });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockValidateAccess).toHaveBeenCalledTimes(2);
      expect(mockForceRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
      });
      expect(result.nextState).toBe('ONBOARDING_START');
    });

    it('does not reconnect for a non-authorization access error', async () => {
      mockValidateAccess.mockResolvedValue({
        kind: 'access-error',
        errorType: 'unknown',
        retryable: false,
      });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockValidateAccess).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.sheetDiscoveryFailed(),
      );
      expect(mockTransitionExecute).not.toHaveBeenCalled();
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });
  });

  describe('token errors', () => {
    it('sends reconnect message and transitions to ONBOARDING_START when token is missing', async () => {
      mockGetValidAccessToken.mockRejectedValue(
        new SpreadsheetError('No active token', { code: 'AUTH_ERROR' }),
      );

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
      });
      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockValidateAccess).not.toHaveBeenCalled();
    });

    it('sends reconnect message when the google token lacks the spreadsheets write scope', async () => {
      mockGetValidAccessToken.mockRejectedValue(
        new SpreadsheetError('Missing scope', { code: 'AUTH_ERROR' }),
      );

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
      });
      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockValidateAccess).not.toHaveBeenCalled();
    });

    it('continues access validation when an expired token refreshes', async () => {
      mockGetValidAccessToken.mockResolvedValue({
        accessToken: 'refreshed-access-token',
        expiresAt: new Date(Date.now() + 3600_000),
        refreshed: true,
      });
      mockValidateAccess.mockResolvedValue({ kind: 'success', preview: mockPreview });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockCreatePort).toHaveBeenCalledWith('google', 'refreshed-access-token');
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
      expect(mockValidateAccess).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
    });

    it('sends reconnect message and transitions to ONBOARDING_START when token is revoked', async () => {
      mockGetValidAccessToken.mockRejectedValue(
        new SpreadsheetError('Revoked token', { code: 'AUTH_ERROR' }),
      );

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
      });
      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockValidateAccess).not.toHaveBeenCalled();
    });

    it('sends reconnect message and transitions to ONBOARDING_START when decryption fails', async () => {
      mockGetValidAccessToken.mockRejectedValue(
        new SpreadsheetError('Stored token cannot be decrypted', { code: 'AUTH_ERROR' }),
      );

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
      });
      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockValidateAccess).not.toHaveBeenCalled();
    });
  });

  describe('missing state data', () => {
    it('sends reconnect message when fileId is missing', async () => {
      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: { selectedSheetName: 'Gastos', provider: 'google' },
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockValidateAccess).not.toHaveBeenCalled();
    });

    it('sends reconnect message when sheetName is missing', async () => {
      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: { selectedFileId: 'file-123', provider: 'google' },
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockValidateAccess).not.toHaveBeenCalled();
    });
  });

  describe('microsoft provider', () => {
    it('sends coming soon message and stays in ONBOARDING_VALIDATING_ACCESS', async () => {
      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: {
          provider: 'microsoft',
          selectedFileId: 'file-123',
          selectedSheetName: 'Gastos',
        },
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.comingSoon('OneDrive'),
      );
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
      expect(mockValidateAccess).not.toHaveBeenCalled();
    });
  });

  describe('eager advance to column mapping inference (ADR-014)', () => {
    it('invokes InferColumnMapping after successful access validation', async () => {
      mockValidateAccess.mockResolvedValue({ kind: 'success', preview: mockPreview });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      const lastCall = mockInferColumnMapping.mock.lastCall as unknown as Parameters<
        ValidateSpreadsheetAccessDeps['inferColumnMapping']['execute']
      >;
      const call = lastCall[0];
      expect(call).toMatchObject({
        userId: 'user-123',
        externalId: '987654321',
        channel: 'telegram',
      });
      expect(call.statePayload).toMatchObject({
        selectedFileId: 'file-123',
        selectedFileName: 'Mi Planilla',
        selectedSheetName: 'Gastos',
        provider: 'google',
      });
      const preview = (call.statePayload as { preview?: { rows?: unknown[] } }).preview;
      expect(preview?.rows).toEqual([{ index: 1, values: ['Fecha', 'Concepto', 'Monto'] }]);
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
    });

    it('logs and preserves the success outcome when InferColumnMapping throws', async () => {
      mockValidateAccess.mockResolvedValue({ kind: 'success', preview: mockPreview });
      mockInferColumnMapping.mockRejectedValue(new Error('inference down'));

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'ValidateSpreadsheetAccess',
          code: 'POST_VALIDATING_ACCESS_MAPPING_FAILED',
          userId: 'user-123',
          error: 'inference down',
        }),
      );
      // The success outcome is unchanged by the eager-advance failure.
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
      expect(mockUpdateAccessVerified).toHaveBeenCalledWith('config-1');
    });

    it('does not invoke InferColumnMapping on read-only', async () => {
      mockValidateAccess.mockResolvedValue({ kind: 'read-only', preview: mockPreview });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      await useCase.execute({ ...baseInput, statePayload: mockStatePayload });

      expect(mockInferColumnMapping).not.toHaveBeenCalled();
    });

    it('does not invoke InferColumnMapping on empty-sheet', async () => {
      mockValidateAccess.mockResolvedValue({ kind: 'empty-sheet' });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      await useCase.execute({ ...baseInput, statePayload: mockStatePayload });

      expect(mockInferColumnMapping).not.toHaveBeenCalled();
    });

    it('does not invoke InferColumnMapping on access-error', async () => {
      mockValidateAccess.mockResolvedValue({
        kind: 'access-error',
        errorType: 'permission-denied',
        retryable: false,
      });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      await useCase.execute({ ...baseInput, statePayload: mockStatePayload });

      expect(mockInferColumnMapping).not.toHaveBeenCalled();
    });

    it('does not invoke InferColumnMapping when token is missing', async () => {
      mockGetValidAccessToken.mockRejectedValue(
        new SpreadsheetError('No active token', { code: 'AUTH_ERROR' }),
      );

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      await useCase.execute({ ...baseInput, statePayload: mockStatePayload });

      expect(mockInferColumnMapping).not.toHaveBeenCalled();
    });
  });
});

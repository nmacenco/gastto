// LAYER: Application / Tests
// Unit tests for ValidateSpreadsheetAccess use case.
// Mocks ValidateSpreadsheetAccessPortFactory, IOAuthTokenRepository,
// TransitionConversationState, MessagingOutputPort, TokenEncryptionPort,
// and ISpreadsheetConfigRepository.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ValidateSpreadsheetAccess,
  type ValidateSpreadsheetAccessDeps,
  type ValidateSpreadsheetAccessInput,
} from './ValidateSpreadsheetAccess';
import type { IOAuthTokenRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { SpreadsheetPreview } from '../../../domain/entities/SpreadsheetPreview';
import { onboardingCopies } from '../../copies/onboarding.copies';

const mockValidateAccess = vi.fn();
const mockFindToken = vi.fn();
const mockTransitionExecute = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();
const mockFindByUserId = vi.fn();
const mockUpdateAccessVerified = vi.fn();
const mockCreatePort = vi.fn().mockReturnValue({
  validateSpreadsheetAccess: mockValidateAccess,
});

function buildMockDeps(
  overrides: Partial<ValidateSpreadsheetAccessDeps> = {},
): ValidateSpreadsheetAccessDeps {
  return {
    validateSpreadsheetAccessPortFactory: {
      create: mockCreatePort,
    },
    tokenRepository: {
      findByUserAndProvider: mockFindToken,
    } as unknown as IOAuthTokenRepository,
    transitionState: {
      execute: mockTransitionExecute,
    } as unknown as TransitionConversationState,
    messagingPort: { sendMessage: mockSendMessage },
    tokenEncryption: {
      encrypt: mockEncrypt,
      decrypt: mockDecrypt,
    },
    spreadsheetConfigRepository: {
      findByUserId: mockFindByUserId,
      updateAccessVerified: mockUpdateAccessVerified,
    } as unknown as ValidateSpreadsheetAccessDeps['spreadsheetConfigRepository'],
    ...overrides,
  };
}

const baseInput: ValidateSpreadsheetAccessInput = {
  userId: 'user-123',
  externalId: '987654321',
  channel: 'telegram',
  statePayload: null,
};

const mockToken = {
  id: 'token-1',
  userId: 'user-123',
  provider: 'google' as const,
  accessTokenEnc: Buffer.from('enc'),
  refreshTokenEnc: Buffer.from('ref'),
  iv: Buffer.from('iv'),
  accessTokenExpiresAt: new Date(Date.now() + 3600_000),
  scope: ['drive.file'],
  grantedAt: new Date(),
  lastRefreshedAt: null,
  revokedAt: null,
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
  mockDecrypt.mockReturnValue('decrypted-access-token');
  mockFindToken.mockResolvedValue(mockToken);
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
    it('retries once automatically when retryable and succeeds on retry', async () => {
      mockValidateAccess
        .mockResolvedValueOnce({
          kind: 'access-error',
          errorType: 'network-error',
          retryable: true,
        })
        .mockResolvedValueOnce({ kind: 'success', preview: mockPreview });

      const deps = buildMockDeps();
      const useCase = new ValidateSpreadsheetAccess(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockValidateAccess).toHaveBeenCalledTimes(2);
      expect(mockValidateAccess).toHaveBeenNthCalledWith(1, 'file-123', 'Gastos');
      expect(mockValidateAccess).toHaveBeenNthCalledWith(2, 'file-123', 'Gastos');
      expect(mockUpdateAccessVerified).toHaveBeenCalledWith('config-1');
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sends reconnect message and transitions to ONBOARDING_START when retry also fails', async () => {
      mockValidateAccess
        .mockResolvedValueOnce({
          kind: 'access-error',
          errorType: 'network-error',
          retryable: true,
        })
        .mockResolvedValueOnce({
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

      expect(mockValidateAccess).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_START',
      });
      expect(result.nextState).toBe('ONBOARDING_START');
    });

    it('does not retry when error is not retryable', async () => {
      mockValidateAccess.mockResolvedValue({
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

      expect(mockValidateAccess).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_START',
      });
      expect(result.nextState).toBe('ONBOARDING_START');
    });
  });

  describe('token errors', () => {
    it('sends reconnect message and transitions to ONBOARDING_START when token is missing', async () => {
      mockFindToken.mockResolvedValue(null);

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
      });
      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockValidateAccess).not.toHaveBeenCalled();
    });

    it('sends reconnect message and transitions to ONBOARDING_START when token is expired', async () => {
      mockFindToken.mockResolvedValue({
        ...mockToken,
        accessTokenExpiresAt: new Date(Date.now() - 3600_000),
      });

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
      });
      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockValidateAccess).not.toHaveBeenCalled();
    });

    it('sends reconnect message and transitions to ONBOARDING_START when token is revoked', async () => {
      mockFindToken.mockResolvedValue({
        ...mockToken,
        revokedAt: new Date(),
      });

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
      });
      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockValidateAccess).not.toHaveBeenCalled();
    });

    it('sends reconnect message and transitions to ONBOARDING_START when decryption fails', async () => {
      mockDecrypt.mockImplementation(() => {
        throw new Error('decryption failed');
      });

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
});

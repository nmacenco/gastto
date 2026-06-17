// LAYER: Application / Tests
// Unit tests for ValidateSpreadsheetAccess use case (skeleton — success path only).
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
        },
      });
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
      expect(result.message).toBe('');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
});

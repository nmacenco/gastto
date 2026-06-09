// LAYER: Application / Tests
// Unit tests for HandleSpreadsheetFileSelection use case.
// Mocks CloudStoragePort, IOAuthTokenRepository, TransitionConversationState,
// MessagingOutputPort, and TokenEncryptionPort.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HandleSpreadsheetFileSelection,
  type HandleSpreadsheetFileSelectionDeps,
  type HandleSpreadsheetFileSelectionInput,
} from './HandleSpreadsheetFileSelection';
import type { IOAuthTokenRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { CloudFile } from '../../../domain/entities/CloudFile';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { FileDiscoveryError } from '../../../domain/errors/FileDiscoveryError';

const mockListRecent = vi.fn();
const mockSearch = vi.fn();
const mockValidateAccess = vi.fn();
const mockFindToken = vi.fn();
const mockTransitionExecute = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();

function buildMockDeps(
  overrides: Partial<HandleSpreadsheetFileSelectionDeps> = {},
): HandleSpreadsheetFileSelectionDeps {
  return {
    cloudStorage: {
      listRecentSpreadsheets: mockListRecent,
      searchSpreadsheets: mockSearch,
      validateFileAccess: mockValidateAccess,
    },
    tokenRepository: { findByUserAndProvider: mockFindToken } as unknown as IOAuthTokenRepository,
    transitionState: { execute: mockTransitionExecute } as unknown as TransitionConversationState,
    messagingPort: { sendMessage: mockSendMessage },
    tokenEncryption: {
      encrypt: mockEncrypt,
      decrypt: mockDecrypt,
    },
    ...overrides,
  };
}

const baseInput: HandleSpreadsheetFileSelectionInput = {
  userId: 'user-123',
  rawMessage: '',
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

const mockFiles = [
  new CloudFile({
    id: 'f1',
    name: 'Gastos 2026',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    modifiedAt: new Date(),
  }),
  new CloudFile({
    id: 'f2',
    name: 'Presupuesto',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    modifiedAt: new Date(),
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
  mockDecrypt.mockReturnValue('decrypted-access-token');
  mockFindToken.mockResolvedValue(mockToken);
});

describe('HandleSpreadsheetFileSelection', () => {
  describe('initial listing', () => {
    it('lists recent spreadsheets and returns ONBOARDING_FILE with fileList', async () => {
      mockListRecent.mockResolvedValue(mockFiles);

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({ ...baseInput, statePayload: null });

      expect(mockListRecent).toHaveBeenCalledWith('decrypted-access-token', 'google');
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        expect.stringContaining('Gastos 2026'),
      );
      expect(mockTransitionExecute).toHaveBeenCalledOnce();
      const transitionCall = mockTransitionExecute.mock.calls[0]![0] as {
        payload: { fileList: unknown[] };
      };
      expect(transitionCall.payload.fileList).toHaveLength(2);
      expect(result.nextState).toBe('ONBOARDING_FILE');
    });

    it('returns noFilesFoundPrompt when listing is empty', async () => {
      mockListRecent.mockResolvedValue([]);

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({ ...baseInput, statePayload: null });

      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(result.message).toBe(onboardingCopies.noFilesFoundPrompt());
      expect(mockTransitionExecute).not.toHaveBeenCalled();
    });
  });

  describe('selection by number', () => {
    it('validates access and transitions to ONBOARDING_SHEET on success', async () => {
      mockValidateAccess.mockResolvedValue(true);

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '1',
        statePayload: { fileList: mockFiles },
      });

      expect(mockValidateAccess).toHaveBeenCalledWith('f1', 'decrypted-access-token', 'google');
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        expect.stringContaining('Gastos 2026'),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_SHEET',
        payload: { selectedFileId: 'f1', selectedFileName: 'Gastos 2026' },
      });
      expect(result.nextState).toBe('ONBOARDING_SHEET');
    });

    it('returns access denied message when validation fails', async () => {
      mockValidateAccess.mockResolvedValue(false);

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '1',
        statePayload: { fileList: mockFiles },
      });

      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(result.message).toBe(onboardingCopies.urlValidationFailed());
      expect(mockTransitionExecute).not.toHaveBeenCalled();
    });

    it('returns invalid selection re-prompt for out-of-range number', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '99',
        statePayload: { fileList: mockFiles },
      });

      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(result.message).toBe(onboardingCopies.invalidSelectionRePrompt(2));
    });
  });

  describe('"none of these"', () => {
    it('prompts for search and sets step to searching', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'ninguno de estos',
        statePayload: { fileList: mockFiles },
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.searchByNamePrompt(),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_FILE',
        payload: { step: 'searching' },
      });
      expect(result.nextState).toBe('ONBOARDING_FILE');
    });
  });

  describe('search by name', () => {
    it('calls searchSpreadsheets and presents results', async () => {
      mockSearch.mockResolvedValue([mockFiles[0]]);

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'gastos',
        statePayload: { step: 'searching' },
      });

      expect(mockSearch).toHaveBeenCalledWith('decrypted-access-token', 'google', 'gastos');
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        expect.stringContaining('Gastos 2026'),
      );
      expect(mockTransitionExecute).toHaveBeenCalledOnce();
      const transitionCall = mockTransitionExecute.mock.calls[0]![0] as {
        payload: { fileList: unknown[] };
      };
      expect(transitionCall.payload.fileList).toHaveLength(1);
      expect(result.nextState).toBe('ONBOARDING_FILE');
    });

    it('returns noFilesFoundPrompt when search returns empty', async () => {
      mockSearch.mockResolvedValue([]);

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'gastos',
        statePayload: { step: 'searching' },
      });

      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(result.message).toBe(onboardingCopies.noFilesFoundPrompt());
    });
  });

  describe('direct URL', () => {
    it('extracts fileId, validates access, and transitions to ONBOARDING_SHEET on success', async () => {
      mockValidateAccess.mockResolvedValue(true);

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const url = 'https://drive.google.com/file/d/ABC123/view';
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: url,
        statePayload: { fileList: mockFiles },
      });

      expect(mockValidateAccess).toHaveBeenCalledWith('ABC123', 'decrypted-access-token', 'google');
      expect(mockSendMessage).toHaveBeenCalledWith('987654321', expect.stringContaining('ABC123'));
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_SHEET',
        payload: { selectedFileId: 'ABC123', selectedFileName: url },
      });
      expect(result.nextState).toBe('ONBOARDING_SHEET');
    });

    it('returns urlValidationFailed when access is denied', async () => {
      mockValidateAccess.mockResolvedValue(false);

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'https://drive.google.com/file/d/ABC123/view',
        statePayload: { fileList: mockFiles },
      });

      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(result.message).toBe(onboardingCopies.urlValidationFailed());
    });
  });

  describe('error paths', () => {
    it('returns connection failed when token is missing', async () => {
      mockFindToken.mockResolvedValue(null);

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({ ...baseInput, statePayload: null });

      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(result.message).toBe(onboardingCopies.connectionFailed(true));
    });

    it('returns connection failed when token is expired', async () => {
      mockFindToken.mockResolvedValue({
        ...mockToken,
        accessTokenExpiresAt: new Date(Date.now() - 3600_000),
      });

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({ ...baseInput, statePayload: null });

      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(result.message).toBe(onboardingCopies.connectionFailed(true));
    });

    it('returns connection failed when token is revoked', async () => {
      mockFindToken.mockResolvedValue({
        ...mockToken,
        revokedAt: new Date(),
      });

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({ ...baseInput, statePayload: null });

      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(result.message).toBe(onboardingCopies.connectionFailed(true));
    });

    it('returns coming soon for microsoft provider', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: { provider: 'microsoft' },
      });

      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(result.message).toBe(onboardingCopies.comingSoon('OneDrive'));
    });

    it('returns error message on FileDiscoveryError during listing', async () => {
      mockListRecent.mockRejectedValue(new FileDiscoveryError('network error'));

      const deps = buildMockDeps();
      const useCase = new HandleSpreadsheetFileSelection(deps);
      const result = await useCase.execute({ ...baseInput, statePayload: null });

      expect(result.nextState).toBe('ONBOARDING_FILE');
      expect(result.message).toContain('network error');
    });
  });
});

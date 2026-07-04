// LAYER: Application / Tests
// Unit tests for HandleSheetSelection use case.
// Mocks SpreadsheetPortFactory, IOAuthTokenRepository, TransitionConversationState,
// MessagingOutputPort, TokenEncryptionPort, and ISpreadsheetConfigRepository.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HandleSheetSelection,
  type HandleSheetSelectionDeps,
  type HandleSheetSelectionInput,
} from './HandleSheetSelection';
import type { IOAuthTokenRepository } from '../../../domain/ports/repositories';
import type {
  TransitionConversationState,
  TransitionConversationStateInput,
} from '../conversation/TransitionConversationState';
import { SheetInfo } from '../../../domain/entities/SheetInfo';
import { canTransition, type FsmState } from '../../../domain/entities/ConversationState';
import { InvalidStateTransitionError } from '../../../domain/errors/InvalidStateTransitionError';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

const mockListSheets = vi.fn();
const mockGetHeaders = vi.fn();
const mockFindToken = vi.fn();
const mockTransitionExecute = vi.fn((input: TransitionConversationStateInput) => {
  const fromState: FsmState = 'ONBOARDING_SHEET';
  if (!canTransition(fromState, input.targetState)) {
    throw new InvalidStateTransitionError(fromState, input.targetState);
  }
  return Promise.resolve({
    userId: input.userId,
    currentState: input.targetState,
    statePayload: input.payload ?? null,
    enteredAt: new Date(),
    expiresAt: input.expiresAt ?? null,
    updatedAt: new Date(),
  });
});
const mockReconnectTransitionExecute = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();
const mockCreateConfig = vi.fn();
const mockLoggerError = vi.fn();
const mockCreatePort = vi.fn().mockImplementation((_provider, _accessToken) => ({
  listSheets: mockListSheets,
  getHeaders: mockGetHeaders,
}));

function buildMockDeps(
  overrides: Partial<HandleSheetSelectionDeps> = {},
): HandleSheetSelectionDeps {
  return {
    spreadsheetPortFactory: {
      create: mockCreatePort,
    },
    tokenRepository: {
      findByUserAndProvider: mockFindToken,
    } as unknown as IOAuthTokenRepository,
    transitionState: { execute: mockTransitionExecute } as unknown as TransitionConversationState,
    messagingPort: { sendMessage: mockSendMessage },
    tokenEncryption: {
      encrypt: mockEncrypt,
      decrypt: mockDecrypt,
    },
    spreadsheetConfigRepository: {
      create: mockCreateConfig,
    } as unknown as HandleSheetSelectionDeps['spreadsheetConfigRepository'],
    logger: { error: mockLoggerError } as unknown as HandleSheetSelectionDeps['logger'],
    ...overrides,
  };
}

const baseInput: HandleSheetSelectionInput = {
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

const mockSheets = [
  new SheetInfo({ name: 'Gastos', index: 0 }),
  new SheetInfo({ name: 'Resumen', index: 1 }),
  new SheetInfo({ name: 'Presupuesto', index: 2 }),
];

const mockFilePayload = {
  selectedFileId: 'file-123',
  selectedFileName: 'Mi Planilla',
  provider: 'google',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDecrypt.mockReturnValue('decrypted-access-token');
  mockFindToken.mockResolvedValue(mockToken);
  mockCreateConfig.mockResolvedValue({
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
});

describe('HandleSheetSelection', () => {
  describe('initial listing — single sheet', () => {
    it('auto-confirms, persists, and transitions to ONBOARDING_VALIDATING_ACCESS', async () => {
      mockListSheets.mockResolvedValue([mockSheets[0]]);

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockFilePayload,
      });

      expect(mockListSheets).toHaveBeenCalledWith('file-123');
      expect(mockCreateConfig).toHaveBeenCalledWith({
        userId: 'user-123',
        provider: 'google',
        fileId: 'file-123',
        fileName: 'Mi Planilla',
        sheetName: 'Gastos',
        accessVerifiedAt: expect.any(Date) as Date,
      });
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_VALIDATING_ACCESS',
        payload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
      expect(result.message).toContain('Gastos');
    });
  });

  describe('initial listing — multiple sheets', () => {
    it('lists sheets and prompts user to choose', async () => {
      mockListSheets.mockResolvedValue(mockSheets);

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockFilePayload,
      });

      expect(mockListSheets).toHaveBeenCalledWith('file-123');
      expect(mockSendMessage).toHaveBeenCalledWith('987654321', expect.stringContaining('Gastos'));
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_SHEET',
        payload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          provider: 'google',
          sheetList: expect.any(Array) as SheetInfo[],
        },
      });
      expect(result.nextState).toBe('ONBOARDING_SHEET');
    });

    it('returns error message when file has no sheets', async () => {
      mockListSheets.mockResolvedValue([]);

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockFilePayload,
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toContain('no tiene hojas');
      expect(mockTransitionExecute).not.toHaveBeenCalled();
    });
  });

  describe('selection by number', () => {
    it('confirms, persists, and transitions to ONBOARDING_VALIDATING_ACCESS', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '2',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(mockCreateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sheetName: 'Resumen' }),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith(
        expect.objectContaining({ targetState: 'ONBOARDING_VALIDATING_ACCESS' }),
      );
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });

    it('returns invalid re-prompt for out-of-range number', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '99',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toBe(onboardingCopies.sheetNotFoundRePrompt(mockSheets));
      expect(mockCreateConfig).not.toHaveBeenCalled();
    });

    it('returns invalid re-prompt for selection "0"', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '0',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toBe(onboardingCopies.sheetNotFoundRePrompt(mockSheets));
      expect(mockCreateConfig).not.toHaveBeenCalled();
    });

    it('accepts selection by number with surrounding whitespace', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '  2  ',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(mockCreateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sheetName: 'Resumen' }),
      );
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });
  });

  describe('selection by name (fuzzy matching)', () => {
    it('matches exact name and confirms', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'Resumen',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(mockCreateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sheetName: 'Resumen' }),
      );
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });

    it('matches with accent normalization', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'resumen',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(mockCreateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sheetName: 'Resumen' }),
      );
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });

    it('matches with accent and case normalization', async () => {
      const sheets = [
        new SheetInfo({ name: 'Gastos del Mes', index: 0 }),
        new SheetInfo({ name: 'Resumen', index: 1 }),
      ];
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'gastos del mes',
        statePayload: { ...mockFilePayload, sheetList: sheets },
      });

      expect(mockCreateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sheetName: 'Gastos del Mes' }),
      );
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });

    it('matches name with surrounding whitespace', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '  Resumen  ',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(mockCreateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sheetName: 'Resumen' }),
      );
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });
  });

  describe('"I do not know" variant', () => {
    it('describes each sheet with headers and re-prompts', async () => {
      mockGetHeaders
        .mockResolvedValueOnce(['Fecha', 'Concepto', 'Monto', 'Moneda'])
        .mockResolvedValueOnce(['Categoría', 'Total', 'Porcentaje'])
        .mockResolvedValueOnce(['Presupuesto', 'Gastado', 'Restante']);

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'no sé',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(mockGetHeaders).toHaveBeenCalledWith('file-123', 'Gastos');
      expect(mockGetHeaders).toHaveBeenCalledWith('file-123', 'Resumen');
      expect(mockGetHeaders).toHaveBeenCalledWith('file-123', 'Presupuesto');
      expect(mockSendMessage).toHaveBeenCalledWith('987654321', expect.stringContaining('Fecha'));
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_SHEET',
        payload: {
          selectedFileId: 'file-123',
          sheetList: expect.any(Array) as SheetInfo[],
          step: 'idk',
        },
      });
      expect(result.nextState).toBe('ONBOARDING_SHEET');
    });

    it('handles "ni idea" variant', async () => {
      mockGetHeaders.mockResolvedValue(['Fecha', 'Monto']);

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'ni idea',
        statePayload: {
          ...mockFilePayload,
          sheetList: [new SheetInfo({ name: 'Gastos', index: 0 })],
        },
      });

      expect(mockGetHeaders).toHaveBeenCalledWith('file-123', 'Gastos');
      expect(result.nextState).toBe('ONBOARDING_SHEET');
    });
  });

  describe('invalid name', () => {
    it('re-prompts with the sheet list', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'hoja inexistente',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toBe(onboardingCopies.sheetNotFoundRePrompt(mockSheets));
      expect(mockCreateConfig).not.toHaveBeenCalled();
    });

    it('re-prompts for empty rawMessage when sheetList is present', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toBe(onboardingCopies.sheetNotFoundRePrompt(mockSheets));
      expect(mockCreateConfig).not.toHaveBeenCalled();
    });
  });

  describe('error paths', () => {
    it('returns reconnect message when token is missing', async () => {
      mockFindToken.mockResolvedValue(null);

      const deps = buildMockDeps({
        transitionState: {
          execute: mockReconnectTransitionExecute,
        } as unknown as TransitionConversationState,
      });
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockFilePayload,
      });

      expect(result.nextState).toBe('ONBOARDING_START');
      expect(result.message).toBe(onboardingCopies.reconnectAccount());
      expect(mockReconnectTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
      });
    });

    it('returns reconnect message when token is expired', async () => {
      mockFindToken.mockResolvedValue({
        ...mockToken,
        accessTokenExpiresAt: new Date(Date.now() - 3600_000),
      });

      const deps = buildMockDeps({
        transitionState: {
          execute: mockReconnectTransitionExecute,
        } as unknown as TransitionConversationState,
      });
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockFilePayload,
      });

      expect(result.nextState).toBe('ONBOARDING_START');
      expect(result.message).toBe(onboardingCopies.reconnectAccount());
    });

    it('returns reconnect message when token is revoked', async () => {
      mockFindToken.mockResolvedValue({
        ...mockToken,
        revokedAt: new Date(),
      });

      const deps = buildMockDeps({
        transitionState: {
          execute: mockReconnectTransitionExecute,
        } as unknown as TransitionConversationState,
      });
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockFilePayload,
      });

      expect(result.nextState).toBe('ONBOARDING_START');
      expect(result.message).toBe(onboardingCopies.reconnectAccount());
    });

    it('returns reconnect message when token decryption fails', async () => {
      mockDecrypt.mockImplementation(() => {
        throw new Error('decryption failed');
      });

      const deps = buildMockDeps({
        transitionState: {
          execute: mockReconnectTransitionExecute,
        } as unknown as TransitionConversationState,
      });
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockFilePayload,
      });

      expect(result.nextState).toBe('ONBOARDING_START');
      expect(result.message).toBe(onboardingCopies.reconnectAccount());
    });

    it('returns error message on SpreadsheetError during listSheets', async () => {
      mockListSheets.mockRejectedValue(new SpreadsheetError('network error'));

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockFilePayload,
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toContain('network error');
    });

    it('returns sheet discovery failed on generic error during listSheets', async () => {
      mockListSheets.mockRejectedValue(new Error('unexpected'));

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockFilePayload,
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toBe(onboardingCopies.sheetDiscoveryFailed());
    });

    it('returns error message on SpreadsheetError during getHeaders', async () => {
      mockGetHeaders.mockRejectedValue(new SpreadsheetError('permission denied'));

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'no sé',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toContain('permission denied');
    });

    it('returns sheet discovery failed on generic error during getHeaders', async () => {
      mockGetHeaders.mockRejectedValue(new Error('network timeout'));

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'no sé',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toBe(onboardingCopies.sheetDiscoveryFailed());
    });

    it('returns file access failed when fileId is missing from statePayload', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: { selectedFileName: 'Mi Planilla' },
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toBe(onboardingCopies.fileAccessFailed());
      expect(mockListSheets).not.toHaveBeenCalled();
    });
  });

  describe('microsoft provider', () => {
    it('returns coming soon for microsoft provider', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: {
          provider: 'microsoft',
          selectedFileId: 'file-123',
          selectedFileName: 'test',
        },
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toBe(onboardingCopies.comingSoon('OneDrive'));
    });
  });

  describe('empty-sheet-confirm step', () => {
    const emptySheetPayload = {
      selectedFileId: 'file-123',
      selectedFileName: 'Mi Planilla',
      selectedSheetName: 'Gastos',
      provider: 'google',
      step: 'empty-sheet-confirm',
      sheetList: mockSheets as unknown as Record<string, unknown>[],
    };

    it('sends out-of-MVP message when user confirms with "sí"', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'sí',
        statePayload: emptySheetPayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.emptySheetConfirmedOutOfMvp(),
      );
      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(mockCreateConfig).not.toHaveBeenCalled();
      expect(mockListSheets).not.toHaveBeenCalled();
    });

    it('sends out-of-MVP message when user confirms with "si"', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'si',
        statePayload: emptySheetPayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.emptySheetConfirmedOutOfMvp(),
      );
      expect(result.nextState).toBe('ONBOARDING_SHEET');
    });

    it('sends out-of-MVP message when user confirms with "dale"', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'dale',
        statePayload: emptySheetPayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.emptySheetConfirmedOutOfMvp(),
      );
      expect(result.nextState).toBe('ONBOARDING_SHEET');
    });

    it('treats non-confirm input as sheet selection by number', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '2',
        statePayload: emptySheetPayload,
      });

      expect(mockCreateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sheetName: 'Resumen' }),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith(
        expect.objectContaining({ targetState: 'ONBOARDING_VALIDATING_ACCESS' }),
      );
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });

    it('treats non-confirm input as sheet selection by name', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'Presupuesto',
        statePayload: emptySheetPayload,
      });

      expect(mockCreateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sheetName: 'Presupuesto' }),
      );
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });

    it('re-prompts when selection is invalid', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'hoja inexistente',
        statePayload: emptySheetPayload,
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toBe(onboardingCopies.sheetNotFoundRePrompt(mockSheets));
      expect(mockCreateConfig).not.toHaveBeenCalled();
    });

    it('returns reconnect message when token is missing', async () => {
      mockFindToken.mockResolvedValue(null);

      const deps = buildMockDeps({
        transitionState: {
          execute: mockReconnectTransitionExecute,
        } as unknown as TransitionConversationState,
      });
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '2',
        statePayload: emptySheetPayload,
      });

      expect(result.nextState).toBe('ONBOARDING_START');
      expect(result.message).toBe(onboardingCopies.reconnectAccount());
      expect(mockCreateConfig).not.toHaveBeenCalled();
    });

    it('returns file access failed when sheetList is missing', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '2',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          provider: 'google',
          step: 'empty-sheet-confirm',
        },
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(result.message).toBe(onboardingCopies.fileAccessFailed());
    });
  });
});

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
import type { ValidateSpreadsheetAccessInput } from './ValidateSpreadsheetAccess';
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
const mockUpsertConfig = vi.fn();
const mockLoggerError = vi.fn();
const mockCreatePort = vi.fn().mockReturnValue({
  listSheets: mockListSheets,
  getHeaders: mockGetHeaders,
});
const mockValidateAccess = vi.fn().mockResolvedValue({
  nextState: 'ONBOARDING_MAPPING',
  message: '',
});

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
      upsertByUserId: mockUpsertConfig,
    } as unknown as HandleSheetSelectionDeps['spreadsheetConfigRepository'],
    validateSpreadsheetAccess: {
      execute: mockValidateAccess,
    } as unknown as HandleSheetSelectionDeps['validateSpreadsheetAccess'],
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
  refreshIv: Buffer.from('refresh-iv'),
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
  mockUpsertConfig.mockResolvedValue({
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
      expect(mockUpsertConfig).toHaveBeenCalledWith({
        userId: 'user-123',
        provider: 'google',
        fileId: 'file-123',
        fileName: 'Mi Planilla',
        sheetName: 'Gastos',
        accessVerifiedAt: expect.any(Date) as Date,
        categoriesConfirmedAt: null,
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

      expect(mockUpsertConfig).toHaveBeenCalledWith(
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
      expect(mockUpsertConfig).not.toHaveBeenCalled();
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
      expect(mockUpsertConfig).not.toHaveBeenCalled();
    });

    it('accepts selection by number with surrounding whitespace', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '  2  ',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(mockUpsertConfig).toHaveBeenCalledWith(
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

      expect(mockUpsertConfig).toHaveBeenCalledWith(
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

      expect(mockUpsertConfig).toHaveBeenCalledWith(
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

      expect(mockUpsertConfig).toHaveBeenCalledWith(
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

      expect(mockUpsertConfig).toHaveBeenCalledWith(
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
      expect(mockUpsertConfig).not.toHaveBeenCalled();
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
      expect(mockUpsertConfig).not.toHaveBeenCalled();
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
      expect(mockUpsertConfig).not.toHaveBeenCalled();
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

      expect(mockUpsertConfig).toHaveBeenCalledWith(
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

      expect(mockUpsertConfig).toHaveBeenCalledWith(
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
      expect(mockUpsertConfig).not.toHaveBeenCalled();
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
      expect(mockUpsertConfig).not.toHaveBeenCalled();
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

  describe('eager advance to access validation (ADR-014)', () => {
    it('invokes ValidateSpreadsheetAccess after single-sheet auto-confirm', async () => {
      mockListSheets.mockResolvedValue([mockSheets[0]]);

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockFilePayload,
      });

      expect(mockValidateAccess).toHaveBeenCalledWith({
        userId: 'user-123',
        externalId: '987654321',
        channel: 'telegram',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
      expect(result.message).toContain('Gastos');
    });

    it('invokes ValidateSpreadsheetAccess after selection by number', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '2',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      const lastCall = mockValidateAccess.mock
        .lastCall as unknown as ValidateSpreadsheetAccessInput[];
      const call = lastCall[0]!;
      expect(call).toMatchObject({
        userId: 'user-123',
        externalId: '987654321',
        channel: 'telegram',
      });
      expect(call.statePayload).toMatchObject({
        selectedFileId: 'file-123',
        selectedFileName: 'Mi Planilla',
        selectedSheetName: 'Resumen',
        provider: 'google',
      });
      expect((call.statePayload as { sheetList?: unknown }).sheetList).toEqual(mockSheets);
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });

    it('invokes ValidateSpreadsheetAccess after selection by name', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        rawMessage: 'Presupuesto',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      const lastCall = mockValidateAccess.mock
        .lastCall as unknown as ValidateSpreadsheetAccessInput[];
      const call = lastCall[0]!;
      expect(call.statePayload).toMatchObject({ selectedSheetName: 'Presupuesto' });
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });

    it('logs and preserves the confirmation when ValidateSpreadsheetAccess throws', async () => {
      mockListSheets.mockResolvedValue([mockSheets[0]]);
      mockValidateAccess.mockRejectedValue(new Error('validation down'));

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockFilePayload,
      });

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'HandleSheetSelection',
          code: 'POST_SHEET_VALIDATING_ACCESS_FAILED',
          userId: 'user-123',
          error: 'validation down',
        }),
      );
      // The confirmation outcome is unchanged by the eager-advance failure.
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
      expect(result.message).toContain('Gastos');
      expect(mockSendMessage).toHaveBeenCalledWith('987654321', expect.stringContaining('Gastos'));
    });

    it('does not invoke ValidateSpreadsheetAccess on reconnect (missing token)', async () => {
      mockFindToken.mockResolvedValue(null);

      const deps = buildMockDeps({
        transitionState: {
          execute: mockReconnectTransitionExecute,
        } as unknown as TransitionConversationState,
      });
      const useCase = new HandleSheetSelection(deps);
      await useCase.execute({ ...baseInput, statePayload: mockFilePayload });

      expect(mockValidateAccess).not.toHaveBeenCalled();
    });

    it('does not invoke ValidateSpreadsheetAccess on "I do not know" variant', async () => {
      mockGetHeaders.mockResolvedValue(['Fecha', 'Monto']);

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      await useCase.execute({
        ...baseInput,
        rawMessage: 'no sé',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(mockValidateAccess).not.toHaveBeenCalled();
    });

    it('does not invoke ValidateSpreadsheetAccess on invalid sheet selection', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      await useCase.execute({
        ...baseInput,
        rawMessage: 'hoja inexistente',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(mockValidateAccess).not.toHaveBeenCalled();
    });

    it('does not invoke ValidateSpreadsheetAccess on empty-sheet-confirm "sí"', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);
      await useCase.execute({
        ...baseInput,
        rawMessage: 'sí',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
          step: 'empty-sheet-confirm',
          sheetList: mockSheets as unknown as Record<string, unknown>[],
        },
      });

      expect(mockValidateAccess).not.toHaveBeenCalled();
    });
  });

  describe('confirmSheet ordering and re-onboarding (upsert)', () => {
    it('persists via upsertByUserId, transitions, then sends confirmation message', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);

      await useCase.execute({
        ...baseInput,
        rawMessage: '2',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      const persistenceOrder = vi.fn();
      const transitionOrder = vi.fn();
      const sendOrder = vi.fn();
      mockUpsertConfig.mockImplementationOnce(() => {
        persistenceOrder();
        return Promise.resolve({
          id: 'config-1',
          userId: 'user-123',
          provider: 'google',
          fileId: 'file-123',
          fileName: 'Mi Planilla',
          sheetName: 'Resumen',
          accessVerifiedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
      mockTransitionExecute.mockImplementationOnce(() => {
        transitionOrder();
        return Promise.resolve({
          userId: 'user-123',
          currentState: 'ONBOARDING_VALIDATING_ACCESS',
          statePayload: null,
          enteredAt: new Date(),
          expiresAt: null,
          updatedAt: new Date(),
        });
      });
      mockSendMessage.mockImplementationOnce(() => {
        sendOrder();
        return Promise.resolve({ status: 'success' });
      });

      await useCase.execute({
        ...baseInput,
        rawMessage: '2',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      const persistCall = persistenceOrder.mock.invocationCallOrder[0] as number;
      const transitionCall = transitionOrder.mock.invocationCallOrder[0] as number;
      const sendCall = sendOrder.mock.invocationCallOrder[0] as number;
      expect(persistCall).toBeLessThan(transitionCall);
      expect(transitionCall).toBeLessThan(sendCall);
    });

    it('does not send the confirmation message when persistence throws (no leak on retry)', async () => {
      mockUpsertConfig.mockRejectedValueOnce(new Error('db down'));
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);

      await expect(
        useCase.execute({
          ...baseInput,
          rawMessage: '2',
          statePayload: { ...mockFilePayload, sheetList: mockSheets },
        }),
      ).rejects.toThrow('db down');

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockTransitionExecute).not.toHaveBeenCalled();
    });

    it('invokes upsertByUserId (not create) on re-onboarding when a config already exists', async () => {
      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);

      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '2',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(mockUpsertConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          provider: 'google',
          fileId: 'file-123',
          fileName: 'Mi Planilla',
          sheetName: 'Resumen',
          accessVerifiedAt: expect.any(Date) as Date,
          categoriesConfirmedAt: null,
        }),
      );
      expect(mockCreateConfig).not.toHaveBeenCalled();
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });

    it('upserts again when re-selecting a sheet after a previous onboarding completed', async () => {
      mockUpsertConfig.mockResolvedValueOnce({
        id: 'config-existing',
        userId: 'user-123',
        provider: 'google',
        fileId: 'file-old',
        fileName: 'Old Planilla',
        sheetName: 'Gastos',
        accessVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-06-01T00:00:00Z'),
      });

      const deps = buildMockDeps();
      const useCase = new HandleSheetSelection(deps);

      const result = await useCase.execute({
        ...baseInput,
        rawMessage: '2',
        statePayload: { ...mockFilePayload, sheetList: mockSheets },
      });

      expect(mockUpsertConfig).toHaveBeenCalledTimes(1);
      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });
  });
});

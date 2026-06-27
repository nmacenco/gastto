// LAYER: Application / Tests
// Unit tests for InferColumnMapping use case.
// Mocks all ports: IOAuthTokenRepository, TokenEncryptionPort,
// ISpreadsheetConfigRepository, IColumnMappingRepository, ColumnInferencePort,
// MessagingOutputPort, TransitionConversationState.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InferColumnMapping,
  type InferColumnMappingDeps,
  type InferColumnMappingInput,
} from './InferColumnMapping';
import type { IOAuthTokenRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { onboardingCopies } from '../../copies/onboarding.copies';

const mockFindToken = vi.fn();
const mockTransitionExecute = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();
const mockFindByUserId = vi.fn();
const mockUpsertMany = vi.fn();
const mockInfer = vi.fn();

function buildMockDeps(overrides: Partial<InferColumnMappingDeps> = {}): InferColumnMappingDeps {
  return {
    tokenRepository: {
      findByUserAndProvider: mockFindToken,
    } as unknown as IOAuthTokenRepository,
    tokenEncryption: {
      encrypt: mockEncrypt,
      decrypt: mockDecrypt,
    },
    spreadsheetConfigRepository: {
      findByUserId: mockFindByUserId,
    } as unknown as InferColumnMappingDeps['spreadsheetConfigRepository'],
    columnMappingRepository: {
      upsertMany: mockUpsertMany,
    } as unknown as InferColumnMappingDeps['columnMappingRepository'],
    columnInferencePort: {
      infer: mockInfer,
    },
    messagingPort: { sendMessage: mockSendMessage },
    transitionState: {
      execute: mockTransitionExecute,
    } as unknown as TransitionConversationState,
    ...overrides,
  };
}

const baseInput: InferColumnMappingInput = {
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

const mockConfig = {
  id: 'config-1',
  userId: 'user-123',
  provider: 'google' as const,
  fileId: 'file-123',
  fileName: 'Mi Planilla',
  sheetName: 'Gastos',
  accessVerifiedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPreview = {
  provider: 'google',
  fileId: 'file-123',
  sheetName: 'Gastos',
  rows: [
    { index: 1, values: ['Fecha', 'Monto', 'Categoria'] },
    { index: 2, values: ['01/01/2026', '100.50', 'Comida'] },
    { index: 3, values: ['02/01/2026', '200.75', 'Transporte'] },
  ],
};

const mockStatePayload = {
  selectedFileId: 'file-123',
  selectedFileName: 'Mi Planilla',
  selectedSheetName: 'Gastos',
  provider: 'google',
  preview: mockPreview,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDecrypt.mockReturnValue('decrypted-access-token');
  mockFindToken.mockResolvedValue(mockToken);
  mockFindByUserId.mockResolvedValue(mockConfig);
  mockUpsertMany.mockResolvedValue(undefined);
});

describe('InferColumnMapping', () => {
  describe('Scenario 1: High-confidence mapping', () => {
    it('sends proposal with emoji indicators and persists mappings', async () => {
      mockInfer.mockResolvedValue({
        mappings: [
          { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha', confidence: 'alta' },
          { gasttoField: 'monto', columnIndex: 1, columnHeader: 'Monto', confidence: 'alta' },
          {
            gasttoField: 'categoria',
            columnIndex: 2,
            columnHeader: 'Categoria',
            confidence: 'alta',
          },
        ],
        noHeaderFound: false,
        unmappedFields: [],
      });

      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockInfer).toHaveBeenCalledWith(
        ['Fecha', 'Monto', 'Categoria'],
        [
          ['01/01/2026', '100.50', 'Comida'],
          ['02/01/2026', '200.75', 'Transporte'],
        ],
      );
      expect(mockUpsertMany).toHaveBeenCalledWith([
        {
          spreadsheetId: 'config-1',
          GasttoField: 'fecha',
          columnIndex: 0,
          columnHeader: 'Fecha',
          inferred: true,
          confirmedAt: null,
        },
        {
          spreadsheetId: 'config-1',
          GasttoField: 'monto',
          columnIndex: 1,
          columnHeader: 'Monto',
          inferred: true,
          confirmedAt: null,
        },
        {
          spreadsheetId: 'config-1',
          GasttoField: 'categoria',
          columnIndex: 2,
          columnHeader: 'Categoria',
          inferred: true,
          confirmedAt: null,
        },
      ]);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.mappingProposalHighConfidence(
          [
            { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha', confidence: 'alta' },
            { gasttoField: 'monto', columnIndex: 1, columnHeader: 'Monto', confidence: 'alta' },
            {
              gasttoField: 'categoria',
              columnIndex: 2,
              columnHeader: 'Categoria',
              confidence: 'alta',
            },
          ],
          [],
        ),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_MAPPING',
        payload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
          preview: mockPreview,
          mappings: [
            { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha', confidence: 'alta' },
            { gasttoField: 'monto', columnIndex: 1, columnHeader: 'Monto', confidence: 'alta' },
            {
              gasttoField: 'categoria',
              columnIndex: 2,
              columnHeader: 'Categoria',
              confidence: 'alta',
            },
          ],
          unmappedFields: [],
        },
      });
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
    });
  });

  describe('Scenario 2: Low-confidence mapping', () => {
    it('sends proposal with uncertainty indicator', async () => {
      mockInfer.mockResolvedValue({
        mappings: [
          { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fcha', confidence: 'baja' },
          { gasttoField: 'monto', columnIndex: 1, columnHeader: 'Mnto', confidence: 'baja' },
        ],
        noHeaderFound: false,
        unmappedFields: [],
      });

      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.mappingProposalLowConfidence(
          [
            { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fcha', confidence: 'baja' },
            { gasttoField: 'monto', columnIndex: 1, columnHeader: 'Mnto', confidence: 'baja' },
          ],
          [],
        ),
      );
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
    });
  });

  describe('Scenario 3: No headers detected', () => {
    it('self-transitions with step no-header and sends no-header prompt', async () => {
      mockInfer.mockResolvedValue({
        mappings: [],
        noHeaderFound: true,
        unmappedFields: ['fecha', 'monto', 'categoria', 'concepto', 'medio_pago', 'moneda'],
      });

      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith('987654321', onboardingCopies.noHeaderPrompt());
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_MAPPING',
        payload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
          preview: mockPreview,
          step: 'no-header',
        },
      });
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
    });
  });

  describe('Scenario 4: Unmapped fields', () => {
    it('includes unmapped fields note in proposal message', async () => {
      mockInfer.mockResolvedValue({
        mappings: [
          { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha', confidence: 'alta' },
          { gasttoField: 'monto', columnIndex: 1, columnHeader: 'Monto', confidence: 'alta' },
        ],
        noHeaderFound: false,
        unmappedFields: ['categoria', 'concepto', 'medio_pago', 'moneda'],
      });

      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.mappingProposalHighConfidence(
          [
            { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha', confidence: 'alta' },
            { gasttoField: 'monto', columnIndex: 1, columnHeader: 'Monto', confidence: 'alta' },
          ],
          ['categoria', 'concepto', 'medio_pago', 'moneda'],
        ),
      );
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
    });
  });

  describe('Scenario 5: Multi-language headers', () => {
    it('recognizes English headers correctly', async () => {
      mockInfer.mockResolvedValue({
        mappings: [
          { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Date', confidence: 'alta' },
          { gasttoField: 'monto', columnIndex: 1, columnHeader: 'Amount', confidence: 'alta' },
          {
            gasttoField: 'categoria',
            columnIndex: 2,
            columnHeader: 'Category',
            confidence: 'alta',
          },
        ],
        noHeaderFound: false,
        unmappedFields: [],
      });

      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: {
          ...mockStatePayload,
          preview: {
            ...mockPreview,
            rows: [{ index: 1, values: ['Date', 'Amount', 'Category'] }],
          },
        },
      });

      expect(mockInfer).toHaveBeenCalledWith(['Date', 'Amount', 'Category'], []);
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
    });
  });

  describe('Token errors', () => {
    it('sends reconnect message and transitions to ONBOARDING_START when token is missing', async () => {
      mockFindToken.mockResolvedValue(null);

      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
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
      expect(mockInfer).not.toHaveBeenCalled();
    });

    it('sends reconnect message and transitions to ONBOARDING_START when token is expired', async () => {
      mockFindToken.mockResolvedValue({
        ...mockToken,
        accessTokenExpiresAt: new Date(Date.now() - 3600_000),
      });

      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(result.nextState).toBe('ONBOARDING_START');
    });

    it('sends reconnect message and transitions to ONBOARDING_START when token is revoked', async () => {
      mockFindToken.mockResolvedValue({
        ...mockToken,
        revokedAt: new Date(),
      });

      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(result.nextState).toBe('ONBOARDING_START');
    });

    it('sends reconnect message and transitions to ONBOARDING_START when decryption fails', async () => {
      mockDecrypt.mockImplementation(() => {
        throw new Error('decryption failed');
      });

      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(result.nextState).toBe('ONBOARDING_START');
    });
  });

  describe('Missing spreadsheet config', () => {
    it('sends reconnect message and transitions to ONBOARDING_START when config is missing', async () => {
      mockFindByUserId.mockResolvedValue(null);

      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: mockStatePayload,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(result.nextState).toBe('ONBOARDING_START');
    });
  });

  describe('Missing preview in payload', () => {
    it('sends reconnect message and transitions to ONBOARDING_START when preview is missing', async () => {
      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: {
          selectedFileId: 'file-123',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockInfer).not.toHaveBeenCalled();
    });

    it('sends reconnect message when preview has no rows', async () => {
      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: {
          ...mockStatePayload,
          preview: { provider: 'google', fileId: 'file-123', sheetName: 'Gastos', rows: [] },
        },
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.reconnectAccount(),
      );
      expect(result.nextState).toBe('ONBOARDING_START');
    });
  });

  describe('Microsoft provider', () => {
    it('sends coming soon message and stays in ONBOARDING_MAPPING', async () => {
      const deps = buildMockDeps();
      const useCase = new InferColumnMapping(deps);
      const result = await useCase.execute({
        ...baseInput,
        statePayload: { provider: 'microsoft' },
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654321',
        onboardingCopies.comingSoon('OneDrive'),
      );
      expect(result.nextState).toBe('ONBOARDING_MAPPING');
      expect(mockInfer).not.toHaveBeenCalled();
    });
  });
});

// LAYER: Application / Tests
// Unit tests for CorrectColumnMapping use case.
// Mocks all ports: repositories, spreadsheet column port, correction parser,
// correction state repository, messaging port, transition state, token repository,
// and token encryption port.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CorrectColumnMapping,
  type CorrectColumnMappingDeps,
  type CorrectColumnMappingInput,
} from './CorrectColumnMapping';
import type {
  IColumnMappingRepository,
  ISpreadsheetConfigRepository,
  IMappingCorrectionStateRepository,
  MappingCorrectionStateSnapshot,
} from '../../../domain/ports/repositories';
import type {
  ISpreadsheetColumnPort,
  AvailableColumn,
} from '../../../domain/ports/spreadsheetColumns';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { ColumnMappingCorrectionParser } from '../../services/ColumnMappingCorrectionParser';
import { RuleBasedColumnMappingCorrectionParser } from '../../services/ColumnMappingCorrectionParser';
import { ColumnMappingCorrectionState } from '../../../domain/value-objects/ColumnMappingCorrectionState';
import { onboardingCopies } from '../../copies/onboarding.copies';
import type { ColumnMapping, SpreadsheetConfig } from '../../../domain/entities/SpreadsheetConfig';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

const mockFindByUserId = vi.fn();
const mockFindBySpreadsheetId = vi.fn();
const mockGetValidAccessToken = vi.fn();
const mockForceRefreshAccessToken = vi.fn();
const mockListAvailableColumns = vi.fn();
const mockParse = vi.fn();
const mockLoadCorrectionState = vi.fn();
const mockSaveCorrectionState = vi.fn();
const mockClearCorrectionState = vi.fn();
const mockDetectHeaderRow = vi.fn();
const mockLLMDetectHeaderRow = vi.fn();
const mockLLMInfer = vi.fn();
const mockUpsertMany = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockTransitionExecute = vi.fn();

function buildMockDeps(
  overrides: Partial<CorrectColumnMappingDeps> = {},
): CorrectColumnMappingDeps {
  return {
    columnMappingRepository: {
      findBySpreadsheetId: mockFindBySpreadsheetId,
      upsertMany: mockUpsertMany,
    } as unknown as IColumnMappingRepository,
    spreadsheetConfigRepository: {
      findByUserId: mockFindByUserId,
    } as unknown as ISpreadsheetConfigRepository,
    oauthAccessTokenService: {
      getValidAccessToken: mockGetValidAccessToken,
      forceRefreshAccessToken: mockForceRefreshAccessToken,
    },
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    spreadsheetColumnPort: {
      listAvailableColumns: mockListAvailableColumns,
    } as unknown as ISpreadsheetColumnPort,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    correctionParser: {
      parse: mockParse,
    } as unknown as ColumnMappingCorrectionParser,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    correctionStateRepository: {
      load: mockLoadCorrectionState,
      save: mockSaveCorrectionState,
      clear: mockClearCorrectionState,
    } as unknown as IMappingCorrectionStateRepository,
    headerDetectionPort: {
      detectHeaderRow: mockDetectHeaderRow,
    },
    llmHeaderDetectionPort: {
      detectHeaderRow: mockLLMDetectHeaderRow,
    },
    llmColumnInferencePort: {
      infer: mockLLMInfer,
    },
    messagingPort: { sendMessage: mockSendMessage },
    transitionState: {
      execute: mockTransitionExecute,
    } as unknown as TransitionConversationState,
    stateTtlSeconds: 1800,
    ...overrides,
  };
}

const mockPreview = {
  provider: 'google',
  fileId: 'file-123',
  sheetName: 'Gastos',
  rows: [
    { index: 1, values: ['Fecha', 'Monto', 'Categoria'] },
    { index: 2, values: ['01/01/2026', '100.50', 'Comida'] },
  ],
};

const baseInput: CorrectColumnMappingInput = {
  userId: 'user-123',
  externalId: '987654321',
  channel: 'telegram',
  rawMessage: 'la categoría está en la columna E',
  statePayload: {
    provider: 'google',
    preview: mockPreview,
    headerRowIndex: 1,
    mappings: [
      { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha', confidence: 'alta' },
      { gasttoField: 'monto', columnIndex: 1, columnHeader: 'Monto', confidence: 'alta' },
      { gasttoField: 'categoria', columnIndex: 2, columnHeader: 'Categoria', confidence: 'alta' },
    ],
    unmappedFields: [],
  },
};

const mockConfig: SpreadsheetConfig = {
  id: 'config-1',
  userId: 'user-123',
  provider: 'google',
  fileId: 'file-123',
  fileName: 'Mi Planilla',
  sheetName: 'Gastos',
  accessVerifiedAt: new Date(),
  categoriesConfirmedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildMockMapping(overrides: Partial<ColumnMapping> = {}): ColumnMapping {
  return {
    id: 'mapping-1',
    spreadsheetId: 'config-1',
    GasttoField: 'categoria',
    columnIndex: 2,
    columnHeader: 'Categoría',
    inferred: true,
    confirmedAt: null,
    ...overrides,
  };
}

const mockMappings: ColumnMapping[] = [
  buildMockMapping({ GasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha' }),
  buildMockMapping({ GasttoField: 'monto', columnIndex: 1, columnHeader: 'Monto' }),
  buildMockMapping({ GasttoField: 'categoria', columnIndex: 2, columnHeader: 'Categoría' }),
];

const availableColumns: AvailableColumn[] = [
  { index: 0, columnHeader: 'Fecha' },
  { index: 1, columnHeader: 'Monto' },
  { index: 2, columnHeader: 'Categoría' },
  { index: 3, columnHeader: 'Descripción' },
  { index: 4, columnHeader: 'Medio de pago' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetValidAccessToken.mockResolvedValue({
    accessToken: 'access-token',
    expiresAt: new Date(Date.now() + 3600_000),
    refreshed: false,
  });
  mockForceRefreshAccessToken.mockResolvedValue({
    accessToken: 'refreshed-access-token',
    expiresAt: new Date(Date.now() + 3600_000),
    refreshed: true,
  });
  mockFindByUserId.mockResolvedValue(mockConfig);
  mockFindBySpreadsheetId.mockResolvedValue(mockMappings);
  mockListAvailableColumns.mockResolvedValue(availableColumns);
  mockParse.mockReturnValue({ kind: 'success', field: 'categoria', columnRef: 'E' });
  mockLoadCorrectionState.mockResolvedValue(null);
  mockSaveCorrectionState.mockResolvedValue(undefined);
  mockUpsertMany.mockResolvedValue(undefined);
  mockDetectHeaderRow.mockResolvedValue(1);
  mockLLMDetectHeaderRow.mockResolvedValue(null);
  mockLLMInfer.mockResolvedValue({ mappings: [], noHeaderFound: false, unmappedFields: [] });
  mockTransitionExecute.mockResolvedValue({
    userId: 'user-123',
    currentState: 'ONBOARDING_MAPPING',
    statePayload: null,
    enteredAt: new Date(),
    expiresAt: null,
    updatedAt: new Date(),
  });
});

describe('CorrectColumnMapping', () => {
  it('applies a valid single-field correction and returns the updated mapping', async () => {
    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(result.kind).toBe('updated');
    expect(result.nextState).toBe('ONBOARDING_MAPPING');

    expect(mockListAvailableColumns).toHaveBeenCalledWith(
      expect.objectContaining({ headerRowIndex: 1 }),
    );

    expect(mockSaveCorrectionState).toHaveBeenCalledTimes(1);
    const savedSnapshot = mockSaveCorrectionState.mock
      .calls[0]![1] as MappingCorrectionStateSnapshot;
    expect(savedSnapshot.corrections).toHaveLength(1);
    expect(savedSnapshot.corrections[0]).toEqual({
      field: 'categoria',
      columnIndex: 4,
      columnHeader: 'Medio de pago',
    });

    const currentMapping = ColumnMappingCorrectionState.create(mockMappings)
      .applyCorrection({ field: 'categoria', columnIndex: 4, columnHeader: 'Medio de pago' })
      .getCurrentMapping();
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.mappingUpdatedConfirmation(
        currentMapping.map((m) => ({
          gasttoField: m.GasttoField,
          columnIndex: m.columnIndex,
          columnHeader: m.columnHeader,
        })),
        [],
      ),
    );

    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_MAPPING',
      payload: {
        provider: 'google',
        fileId: 'file-123',
        sheetName: 'Gastos',
        mappings: currentMapping.map((m) => ({
          gasttoField: m.GasttoField,
          columnIndex: m.columnIndex,
          columnHeader: m.columnHeader,
        })),
        unmappedFields: [],
        headerRowIndex: 1,
      },
      expiresAt: expect.any(Date) as Date,
    });
  });

  it('accumulates corrections for different fields', async () => {
    const previousSnapshot: MappingCorrectionStateSnapshot = {
      originalMapping: mockMappings,
      corrections: [{ field: 'monto', columnIndex: 3, columnHeader: 'Descripción' }],
      status: 'correcting',
    };
    mockLoadCorrectionState.mockResolvedValue(previousSnapshot);

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(result.kind).toBe('updated');
    const savedSnapshot = mockSaveCorrectionState.mock
      .calls[0]![1] as MappingCorrectionStateSnapshot;
    expect(savedSnapshot.corrections).toHaveLength(2);
    expect(savedSnapshot.corrections).toEqual(
      expect.arrayContaining([
        { field: 'monto', columnIndex: 3, columnHeader: 'Descripción' },
        { field: 'categoria', columnIndex: 4, columnHeader: 'Medio de pago' },
      ]),
    );
  });

  it('replaces an earlier correction for the same field', async () => {
    const previousSnapshot: MappingCorrectionStateSnapshot = {
      originalMapping: mockMappings,
      corrections: [{ field: 'categoria', columnIndex: 3, columnHeader: 'Descripción' }],
      status: 'correcting',
    };
    mockLoadCorrectionState.mockResolvedValue(previousSnapshot);

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(result.kind).toBe('updated');
    const savedSnapshot = mockSaveCorrectionState.mock
      .calls[0]![1] as MappingCorrectionStateSnapshot;
    expect(savedSnapshot.corrections).toHaveLength(1);
    expect(savedSnapshot.corrections[0]).toEqual({
      field: 'categoria',
      columnIndex: 4,
      columnHeader: 'Medio de pago',
    });
  });

  it('adds a correction for a previously unmapped field and displays it', async () => {
    mockFindBySpreadsheetId.mockResolvedValue([
      buildMockMapping({
        GasttoField: 'medio_pago',
        columnIndex: 0,
        columnHeader: '',
      }),
    ]);
    mockListAvailableColumns.mockResolvedValue([
      { index: 0, columnHeader: '' },
      { index: 1, columnHeader: '' },
      { index: 2, columnHeader: '' },
      { index: 7, columnHeader: 'Ganancias' },
    ]);

    const useCase = new CorrectColumnMapping(
      buildMockDeps({ correctionParser: new RuleBasedColumnMappingCorrectionParser() }),
    );
    const result = await useCase.execute({
      ...baseInput,
      rawMessage: 'Categoría columna C',
      statePayload: {
        ...baseInput.statePayload,
        unmappedFields: ['monto', 'moneda', 'categoria', 'fecha', 'concepto'],
      },
    });

    expect(result.kind).toBe('updated');
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      expect.stringContaining('Categoría → columna C'),
    );
    expect(mockTransitionExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          mappings: expect.arrayContaining([
            expect.objectContaining({ gasttoField: 'categoria', columnIndex: 2 }),
          ]) as unknown[],
          unmappedFields: ['monto', 'moneda', 'fecha', 'concepto'],
        }) as Record<string, unknown>,
      }),
    );
  });

  it('returns invalid-column when the referenced column does not exist', async () => {
    mockParse.mockReturnValue({ kind: 'success', field: 'categoria', columnRef: 'Z' });

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(result.kind).toBe('invalid-column');
    expect(result.nextState).toBe('ONBOARDING_MAPPING');
    expect((result as { availableColumns: AvailableColumn[] }).availableColumns).toEqual(
      availableColumns,
    );
    expect(mockSaveCorrectionState).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.invalidColumnPrompt('Z', availableColumns),
    );
    expect(mockTransitionExecute).not.toHaveBeenCalled();
  });

  it('returns parse-failure and does not persist state when the message is not a correction', async () => {
    mockParse.mockReturnValue({ kind: 'failure', reason: 'No recognizable column reference' });

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(result.kind).toBe('parse-failure');
    expect(result.nextState).toBe('ONBOARDING_MAPPING');
    expect(mockSaveCorrectionState).not.toHaveBeenCalled();
    expect(mockListAvailableColumns).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.correctionParseFailurePrompt(),
    );
    expect(mockTransitionExecute).not.toHaveBeenCalled();
  });

  it('rejects multiple corrections without applying a partial mapping', async () => {
    const deps = buildMockDeps({
      correctionParser: new RuleBasedColumnMappingCorrectionParser(),
    });
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute({
      ...baseInput,
      rawMessage: 'A Medio de pago. B Fecha. C Categoría. E Importe. F Concepto.',
    });

    expect(result).toEqual({
      kind: 'parse-failure',
      nextState: 'ONBOARDING_MAPPING',
      message: onboardingCopies.multipleMappingCorrectionsPrompt(),
    });
    expect(mockGetValidAccessToken).not.toHaveBeenCalled();
    expect(mockListAvailableColumns).not.toHaveBeenCalled();
    expect(mockLoadCorrectionState).not.toHaveBeenCalled();
    expect(mockSaveCorrectionState).not.toHaveBeenCalled();
    expect(mockTransitionExecute).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.multipleMappingCorrectionsPrompt(),
    );
  });

  it('guides the user to manual correction when they reject the proposal', async () => {
    mockParse.mockReturnValue({ kind: 'failure', reason: 'No recognizable column reference' });

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);
    const result = await useCase.execute({
      ...baseInput,
      rawMessage: 'no, eso está mal',
    });

    expect(result.kind).toBe('rejected');
    expect(result.nextState).toBe('ONBOARDING_MAPPING');
    expect(mockListAvailableColumns).toHaveBeenCalledWith({
      provider: 'google',
      fileId: 'file-123',
      sheetName: 'Gastos',
      accessToken: 'access-token',
      headerRowIndex: 1,
    });
    expect(mockClearCorrectionState).toHaveBeenCalledWith('user-123');
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.mappingRejectionPrompt(availableColumns),
    );
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_MAPPING',
      payload: baseInput.statePayload,
      expiresAt: expect.any(Date) as Date,
    });
  });

  it('uses headerRowIndex from state payload when listing available columns', async () => {
    mockParse.mockReturnValue({ kind: 'failure', reason: 'No recognizable column reference' });

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);
    await useCase.execute({
      ...baseInput,
      statePayload: { ...baseInput.statePayload, headerRowIndex: 2 },
      rawMessage: 'no',
    });

    expect(mockListAvailableColumns).toHaveBeenCalledWith(
      expect.objectContaining({ headerRowIndex: 2 }),
    );
  });

  it('triggers reconnect flow when the OAuth token is missing on rejection', async () => {
    mockParse.mockReturnValue({ kind: 'failure', reason: 'No recognizable column reference' });
    mockGetValidAccessToken.mockRejectedValue(
      new SpreadsheetError('No active token', { code: 'AUTH_ERROR' }),
    );

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);
    const result = await useCase.execute({
      ...baseInput,
      rawMessage: 'no',
    });

    expect(result.kind).toBe('no-proposed-mapping');
    expect(result.nextState).toBe('ONBOARDING_START');
    expect(mockListAvailableColumns).not.toHaveBeenCalled();
    expect(mockClearCorrectionState).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', onboardingCopies.reconnectAccount());
  });

  it('continues correction when an expired OAuth token refreshes on rejection', async () => {
    mockParse.mockReturnValue({ kind: 'failure', reason: 'No recognizable column reference' });
    mockGetValidAccessToken.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      expiresAt: new Date(Date.now() + 3600_000),
      refreshed: true,
    });

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);
    const result = await useCase.execute({
      ...baseInput,
      rawMessage: 'incorrecto',
    });

    expect(result.kind).toBe('rejected');
    expect(result.nextState).toBe('ONBOARDING_MAPPING');
    expect(mockListAvailableColumns).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'refreshed-access-token' }),
    );
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.reconnectAccount(),
    );
  });

  it('triggers reconnect flow when token decryption fails on rejection', async () => {
    mockParse.mockReturnValue({ kind: 'failure', reason: 'No recognizable column reference' });
    mockGetValidAccessToken.mockRejectedValue(
      new SpreadsheetError('Stored token cannot be decrypted', { code: 'AUTH_ERROR' }),
    );

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);
    const result = await useCase.execute({
      ...baseInput,
      rawMessage: 'no es correcto',
    });

    expect(result.kind).toBe('no-proposed-mapping');
    expect(result.nextState).toBe('ONBOARDING_START');
    expect(mockListAvailableColumns).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', onboardingCopies.reconnectAccount());
  });

  it('triggers reconnect flow when spreadsheet config is missing', async () => {
    mockFindByUserId.mockResolvedValue(null);

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(result.kind).toBe('no-proposed-mapping');
    expect(result.nextState).toBe('ONBOARDING_START');
    expect(mockFindBySpreadsheetId).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', onboardingCopies.reconnectAccount());
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });
  });

  it('stays in ONBOARDING_MAPPING when no proposed mappings exist', async () => {
    mockFindBySpreadsheetId.mockResolvedValue([]);

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(result.kind).toBe('no-proposed-mapping');
    expect(result.nextState).toBe('ONBOARDING_MAPPING');
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockSaveCorrectionState).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.noMappingToConfirm(),
    );
    expect(mockTransitionExecute).not.toHaveBeenCalled();
  });

  it('triggers reconnect flow when the OAuth token is missing', async () => {
    mockGetValidAccessToken.mockRejectedValue(
      new SpreadsheetError('No active token', { code: 'AUTH_ERROR' }),
    );

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(result.kind).toBe('no-proposed-mapping');
    expect(result.nextState).toBe('ONBOARDING_START');
    expect(mockListAvailableColumns).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', onboardingCopies.reconnectAccount());
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });
  });

  it('continues correction when an expired OAuth token refreshes', async () => {
    mockGetValidAccessToken.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      expiresAt: new Date(Date.now() + 3600_000),
      refreshed: true,
    });

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(result.kind).toBe('updated');
    expect(result.nextState).toBe('ONBOARDING_MAPPING');
    expect(mockListAvailableColumns).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'refreshed-access-token' }),
    );
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.reconnectAccount(),
    );
  });

  it('triggers reconnect flow when token decryption fails', async () => {
    mockGetValidAccessToken.mockRejectedValue(
      new SpreadsheetError('Stored token cannot be decrypted', { code: 'AUTH_ERROR' }),
    );

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(result.kind).toBe('no-proposed-mapping');
    expect(result.nextState).toBe('ONBOARDING_START');
    expect(mockListAvailableColumns).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', onboardingCopies.reconnectAccount());
  });

  it('does not send confirmation message when correction state save fails', async () => {
    mockSaveCorrectionState.mockRejectedValue(new Error('Redis down'));

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow('Redis down');

    expect(mockSendMessage).not.toHaveBeenCalledWith(
      '987654321',
      expect.stringContaining('Actualicé'),
    );
    expect(mockTransitionExecute).not.toHaveBeenCalled();
  });

  it('sends updated mapping message even when transition state fails', async () => {
    mockTransitionExecute.mockRejectedValue(new Error('Invalid transition'));

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow('Invalid transition');

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', expect.stringContaining('Actualicé'));
  });

  it('resolves column references by numeric index and header name', async () => {
    mockParse.mockReturnValue({ kind: 'success', field: 'concepto', columnRef: 'Descripción' });

    const deps = buildMockDeps();
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute({
      ...baseInput,
      rawMessage: 'el concepto es Descripción',
    });

    expect(result.kind).toBe('updated');
    const savedSnapshot = mockSaveCorrectionState.mock
      .calls[0]![1] as MappingCorrectionStateSnapshot;
    expect(savedSnapshot.corrections[0]).toEqual({
      field: 'concepto',
      columnIndex: 3,
      columnHeader: 'Descripción',
    });
  });

  it('integrates with the real parser for a Spanish correction', async () => {
    const deps = buildMockDeps({
      correctionParser: new RuleBasedColumnMappingCorrectionParser(),
    });
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute({
      ...baseInput,
      rawMessage: 'la categoría está en la columna E',
    });

    expect(result.kind).toBe('updated');
    const savedSnapshot = mockSaveCorrectionState.mock
      .calls[0]![1] as MappingCorrectionStateSnapshot;
    expect(savedSnapshot.corrections[0]).toEqual({
      field: 'categoria',
      columnIndex: 4,
      columnHeader: 'Medio de pago',
    });
  });

  it('integrates with the real parser for an English correction', async () => {
    const deps = buildMockDeps({
      correctionParser: new RuleBasedColumnMappingCorrectionParser(),
    });
    const useCase = new CorrectColumnMapping(deps);

    const result = await useCase.execute({
      ...baseInput,
      rawMessage: 'the amount goes in column 2',
    });

    expect(result.kind).toBe('updated');
    const savedSnapshot = mockSaveCorrectionState.mock
      .calls[0]![1] as MappingCorrectionStateSnapshot;
    expect(savedSnapshot.corrections[0]).toEqual({
      field: 'monto',
      columnIndex: 1,
      columnHeader: 'Monto',
    });
  });
});

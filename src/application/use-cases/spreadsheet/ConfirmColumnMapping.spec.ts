// LAYER: Application / Tests
// Unit tests for ConfirmColumnMapping use case.
// Mocks all ports: IColumnMappingRepository, ISpreadsheetConfigRepository,
// MessagingOutputPort, TransitionConversationState.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConfirmColumnMapping,
  type ConfirmColumnMappingDeps,
  type ConfirmColumnMappingInput,
} from './ConfirmColumnMapping';
import type {
  IColumnMappingRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { onboardingCopies } from '../../copies/onboarding.copies';

const mockFindByUserId = vi.fn();
const mockFindBySpreadsheetId = vi.fn();
const mockConfirmBySpreadsheetId = vi.fn();
const mockUpdateCorrected = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockTransitionExecute = vi.fn();

function buildMockDeps(
  overrides: Partial<ConfirmColumnMappingDeps> = {},
): ConfirmColumnMappingDeps {
  return {
    columnMappingRepository: {
      findBySpreadsheetId: mockFindBySpreadsheetId,
      confirmBySpreadsheetId: mockConfirmBySpreadsheetId,
      updateCorrected: mockUpdateCorrected,
    } as unknown as IColumnMappingRepository,
    spreadsheetConfigRepository: {
      findByUserId: mockFindByUserId,
    } as unknown as ISpreadsheetConfigRepository,
    messagingPort: { sendMessage: mockSendMessage },
    transitionState: {
      execute: mockTransitionExecute,
    } as unknown as TransitionConversationState,
    ...overrides,
  };
}

const baseInput: ConfirmColumnMappingInput = {
  userId: 'user-123',
  externalId: '987654321',
  channel: 'telegram',
  statePayload: {
    provider: 'google',
    fileId: 'file-123',
    sheetName: 'Gastos',
  },
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

const mockMappings = [
  {
    id: 'mapping-1',
    spreadsheetId: 'config-1',
    GasttoField: 'fecha' as const,
    columnIndex: 0,
    columnHeader: 'Fecha',
    inferred: true,
    confirmedAt: null,
  },
  {
    id: 'mapping-2',
    spreadsheetId: 'config-1',
    GasttoField: 'monto' as const,
    columnIndex: 1,
    columnHeader: 'Monto',
    inferred: true,
    confirmedAt: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockFindByUserId.mockResolvedValue(mockConfig);
  mockFindBySpreadsheetId.mockResolvedValue(mockMappings);
  mockConfirmBySpreadsheetId.mockResolvedValue(undefined);
  mockTransitionExecute.mockResolvedValue({
    userId: 'user-123',
    currentState: 'ONBOARDING_CATEGORIES',
    statePayload: null,
    enteredAt: new Date(),
    expiresAt: null,
    updatedAt: new Date(),
  });
});

describe('ConfirmColumnMapping', () => {
  it('confirms all mappings and transitions to ONBOARDING_CATEGORIES', async () => {
    const deps = buildMockDeps();
    const useCase = new ConfirmColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(mockConfirmBySpreadsheetId).toHaveBeenCalledWith('config-1');
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_CATEGORIES',
      payload: {
        provider: 'google',
        fileId: 'file-123',
        sheetName: 'Gastos',
      },
    });
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.mappingConfirmedNextStep(),
    );
    expect(result.nextState).toBe('ONBOARDING_CATEGORIES');
    expect(result.message).toBe(onboardingCopies.mappingConfirmedNextStep());
  });

  it('sends reconnect message when spreadsheet config is missing', async () => {
    mockFindByUserId.mockResolvedValue(null);
    const deps = buildMockDeps();
    const useCase = new ConfirmColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(mockConfirmBySpreadsheetId).not.toHaveBeenCalled();
    expect(mockTransitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });
    expect(mockSendMessage).toHaveBeenCalledWith('987654321', onboardingCopies.reconnectAccount());
    expect(result.nextState).toBe('ONBOARDING_START');
  });

  it('stays in ONBOARDING_MAPPING when no mappings exist', async () => {
    mockFindBySpreadsheetId.mockResolvedValue([]);
    const deps = buildMockDeps();
    const useCase = new ConfirmColumnMapping(deps);

    const result = await useCase.execute(baseInput);

    expect(mockConfirmBySpreadsheetId).not.toHaveBeenCalled();
    expect(mockTransitionExecute).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.noMappingToConfirm(),
    );
    expect(result.nextState).toBe('ONBOARDING_MAPPING');
  });

  it('does not send confirmation message when confirmBySpreadsheetId fails', async () => {
    mockConfirmBySpreadsheetId.mockRejectedValue(new Error('DB error'));
    const deps = buildMockDeps();
    const useCase = new ConfirmColumnMapping(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow('DB error');

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockTransitionExecute).not.toHaveBeenCalled();
  });

  it('does not send confirmation message when transition fails', async () => {
    mockTransitionExecute.mockRejectedValue(new Error('Invalid transition'));
    const deps = buildMockDeps();
    const useCase = new ConfirmColumnMapping(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow('Invalid transition');

    expect(mockConfirmBySpreadsheetId).toHaveBeenCalledWith('config-1');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '987654321',
      onboardingCopies.mappingConfirmedNextStep(),
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ConversationState, FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetConfig } from '../../../domain/entities/SpreadsheetConfig';
import {
  SettingsDestinationFlow,
  type SettingsDestinationFlowDeps,
} from './SettingsDestinationFlow';

const config: SpreadsheetConfig = {
  id: 'config-old',
  userId: 'user-1',
  provider: 'google',
  fileId: 'file-old',
  fileName: 'Expenses',
  sheetName: 'Old',
  isActive: true,
  headerRowIndex: 1,
  accessVerifiedAt: new Date(),
  categoriesConfirmedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};
const sheets = [
  { name: 'Old', index: 0 },
  { name: 'New', index: 1 },
];
const preview = {
  provider: 'google',
  fileId: 'file-old',
  sheetName: 'New',
  rows: [
    { index: 1, values: ['Amount', 'Category'] },
    { index: 2, values: [5, 'Food'] },
  ],
};
const payload = {
  flowId: 'flow-1',
  sourceConfigId: 'config-old',
  fileId: 'file-old',
  fileName: 'Expenses',
  sheetName: 'New',
  proposalId: 'proposal-1',
  sheets,
  preview: preview.rows,
  accessVerifiedAt: new Date().toISOString(),
};

function state(
  currentState: FsmState,
  statePayload: Record<string, unknown> | null,
): ConversationState {
  return {
    userId: 'user-1',
    revision: '3',
    currentState,
    statePayload,
    enteredAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  };
}

function setup() {
  const transition = vi.fn().mockResolvedValue({ status: 'updated' });
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const findByUserId = vi.fn().mockResolvedValue(config);
  const findBySpreadsheetId = vi.fn().mockResolvedValue([
    { GasttoField: 'monto', columnIndex: 0, columnHeader: 'Amount' },
    { GasttoField: 'categoria', columnIndex: 1, columnHeader: 'Category' },
  ]);
  const validateSpreadsheetAccess = vi.fn().mockResolvedValue({ kind: 'success', preview });
  const infer = vi.fn().mockResolvedValue({
    mappings: [
      { gasttoField: 'monto', columnIndex: 0, columnHeader: 'Amount', confidence: 'alta' },
      { gasttoField: 'categoria', columnIndex: 1, columnHeader: 'Category', confidence: 'alta' },
    ],
    noHeaderFound: false,
    unmappedFields: [],
  });
  const activate = vi.fn().mockResolvedValue('activated');
  const deps = {
    configRepository: { findByUserId },
    mappingRepository: { findBySpreadsheetId },
    spreadsheetPortFactory: { create: () => ({ listSheets: vi.fn().mockResolvedValue(sheets) }) },
    accessPortFactory: { create: () => ({ validateSpreadsheetAccess }) },
    headerDetector: { detectHeaderRow: vi.fn().mockResolvedValue(1) },
    columnInference: { infer },
    categoryReaderFactory: {
      create: () => ({ readCategories: vi.fn().mockResolvedValue(['Food']) }),
    },
    categoryHierarchyReaderFactory: { create: () => ({ readHierarchy: vi.fn() }) },
    tokenService: { getValidAccessToken: vi.fn().mockResolvedValue({ accessToken: 'token' }) },
    activation: { execute: activate },
    transitionState: {
      execute: transition,
      precondition: (observed: ConversationState) => ({
        revision: observed.revision,
        currentState: observed.currentState,
        expiry: 'unexpired',
      }),
    },
    messaging: { sendMessage },
  } as unknown as SettingsDestinationFlowDeps;
  return {
    flow: new SettingsDestinationFlow(deps),
    transition,
    sendMessage,
    findByUserId,
    findBySpreadsheetId,
    validateSpreadsheetAccess,
    infer,
    activate,
  };
}

describe('SettingsDestinationFlow', () => {
  it('lists sheets without mutating the active configuration', async () => {
    const t = setup();
    await t.flow.startSheet(state('SETTINGS_MENU', { flowId: 'menu' }), 'chat-1');
    const write = t.transition.mock.calls[0]?.[0] as unknown as {
      targetState: string;
      payload: Record<string, unknown>;
    };
    expect(write.targetState).toBe('SETTINGS_SHEET');
    expect(write.payload).toMatchObject({
      sourceConfigId: config.id,
      fileId: config.fileId,
      sheets,
    });
    expect(t.sendMessage).toHaveBeenCalledWith('chat-1', expect.stringContaining('2. New'));
  });

  it('rejects a read-only destination while retaining the selection state', async () => {
    const t = setup();
    t.validateSpreadsheetAccess.mockResolvedValue({ kind: 'read-only', preview });
    await t.flow.reply(state('SETTINGS_SHEET', payload), '2', 'chat-1');
    expect(t.transition).not.toHaveBeenCalled();
    expect(t.sendMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.stringContaining('lectura y escritura'),
    );
  });

  it('reuses positions only when header metadata and normalized headers match', async () => {
    const t = setup();
    await t.flow.reply(
      state('SETTINGS_MAPPING', { ...payload, step: 'same-columns' }),
      'sí',
      'chat-1',
    );
    expect(t.findBySpreadsheetId).toHaveBeenCalledWith('config-old');
    expect(t.infer).not.toHaveBeenCalled();
    const write = t.transition.mock.calls[0]?.[0] as unknown as {
      targetState: string;
      payload: { mappings: Array<{ field: string; columnIndex: number }> };
    };
    expect(write.targetState).toBe('SETTINGS_MAPPING');
    expect(write.payload.mappings).toContainEqual(
      expect.objectContaining({ field: 'monto', columnIndex: 0 }),
    );
  });

  it('remaps when the saved header row is unknown even if the answer is yes', async () => {
    const t = setup();
    t.findByUserId.mockResolvedValue({ ...config, headerRowIndex: null });
    await t.flow.reply(
      state('SETTINGS_MAPPING', { ...payload, step: 'same-columns' }),
      'sí',
      'chat-1',
    );
    expect(t.infer).toHaveBeenCalledOnce();
    expect(t.transition).toHaveBeenCalledWith(
      expect.objectContaining({ targetState: 'SETTINGS_MAPPING' }),
    );
  });

  it('keeps mapping corrections inside the owned proposal', async () => {
    const t = setup();
    await t.flow.reply(
      state('SETTINGS_MAPPING', {
        ...payload,
        step: 'review',
        headerRowIndex: 1,
        mappings: [{ field: 'monto', columnIndex: 1, columnHeader: 'Category' }],
      }),
      'monto=1',
      'chat-1',
    );
    const write = t.transition.mock.calls[0]?.[0] as unknown as {
      payload: { mappings: unknown[] };
    };
    expect(write.payload.mappings).toEqual([
      { field: 'monto', columnIndex: 0, columnHeader: 'Amount' },
    ]);
  });

  it('activates only after category review and sends completion only on commit', async () => {
    const t = setup();
    const reviewed = {
      ...payload,
      headerRowIndex: 1,
      mappings: [{ field: 'categoria', columnIndex: 1, columnHeader: 'Category' }],
      categories: [{ name: 'Food', subcategories: [] }],
    };
    await t.flow.reply(state('SETTINGS_CATEGORIES', reviewed), 'confirmar', 'chat-1');
    const activation = t.activate.mock.calls[0]?.[0] as unknown as {
      candidate: { sourceConfigId: string; fileId: string };
    };
    expect(activation.candidate).toMatchObject({
      sourceConfigId: config.id,
      fileId: config.fileId,
    });
    expect(t.sendMessage).toHaveBeenCalledWith('chat-1', expect.stringContaining('quedó activa'));
    t.activate.mockResolvedValue('stale');
    t.sendMessage.mockClear();
    await t.flow.reply(state('SETTINGS_CATEGORIES', reviewed), 'confirmar', 'chat-1');
    expect(t.sendMessage).not.toHaveBeenCalled();
  });

  it('cancels only the observed flow and clears its payload', async () => {
    const t = setup();
    await t.flow.reply(state('SETTINGS_MAPPING', payload), 'cancelar', 'chat-1');
    expect(t.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        targetState: 'IDLE',
        payload: null,
        expected: {
          revision: '3',
          currentState: 'SETTINGS_MAPPING',
          expiry: 'unexpired',
        },
      }),
    );
    expect(t.activate).not.toHaveBeenCalled();
  });
});

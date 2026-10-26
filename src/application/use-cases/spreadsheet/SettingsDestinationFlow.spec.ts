import { describe, expect, it, vi } from 'vitest';
import type { ConversationState, FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetConfig } from '../../../domain/entities/SpreadsheetConfig';
import {
  SettingsDestinationFlow,
  parseGoogleSpreadsheetLink,
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
const filePayload = {
  flowId: 'flow-file',
  sourceConfigId: 'config-old',
  origin: 'file',
  fileId: 'file-old',
  fileName: 'Expenses',
  files: [
    { id: 'file-new', name: 'New Expenses' },
    { id: 'file-other', name: 'Other Expenses' },
  ],
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
  const listRecentSpreadsheets = vi.fn().mockResolvedValue([
    { id: 'file-new', name: 'New Expenses' },
    { id: 'file-other', name: 'Other Expenses' },
  ]);
  const searchSpreadsheets = vi.fn().mockResolvedValue([{ id: 'file-searched', name: 'Searched' }]);
  const validateFileAccess = vi.fn().mockResolvedValue(true);
  const listSheets = vi.fn().mockResolvedValue(sheets);
  const getValidAccessToken = vi.fn().mockResolvedValue({ accessToken: 'token' });
  const detectPaymentMethods = vi.fn().mockResolvedValue({ names: ['Visa'], columnMapped: true });
  const deps = {
    configRepository: { findByUserId },
    cloudStorage: { listRecentSpreadsheets, searchSpreadsheets, validateFileAccess },
    mappingRepository: { findBySpreadsheetId },
    spreadsheetPortFactory: { create: () => ({ listSheets }) },
    accessPortFactory: { create: () => ({ validateSpreadsheetAccess }) },
    headerDetector: { detectHeaderRow: vi.fn().mockResolvedValue(1) },
    columnInference: { infer },
    categoryReaderFactory: {
      create: () => ({ readCategories: vi.fn().mockResolvedValue(['Food']) }),
    },
    categoryHierarchyReaderFactory: { create: () => ({ readHierarchy: vi.fn() }) },
    tokenService: { getValidAccessToken },
    detectPaymentMethods: { execute: detectPaymentMethods },
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
    listRecentSpreadsheets,
    searchSpreadsheets,
    validateFileAccess,
    listSheets,
    tokenService: { getValidAccessToken },
    detectPaymentMethods,
  };
}

describe('parseGoogleSpreadsheetLink', () => {
  it('accepts supported Google spreadsheet links and rejects other hosts', () => {
    expect(parseGoogleSpreadsheetLink('https://docs.google.com/spreadsheets/d/abc_123/edit')).toBe(
      'abc_123',
    );
    expect(parseGoogleSpreadsheetLink('https://drive.google.com/file/d/xyz-7/view')).toBe('xyz-7');
    expect(parseGoogleSpreadsheetLink('https://drive.google.com/open?id=xyz-7')).toBe('xyz-7');
    expect(parseGoogleSpreadsheetLink('https://drive.google.com/other?id=xyz-7')).toBeNull();
    expect(parseGoogleSpreadsheetLink('https://evil.example/spreadsheets/d/abc_123')).toBeNull();
    expect(
      parseGoogleSpreadsheetLink('http://docs.google.com/spreadsheets/d/abc_123/edit'),
    ).toBeNull();
  });
});

describe('SettingsDestinationFlow', () => {
  it('lists recent files in a guarded settings candidate', async () => {
    const t = setup();
    await t.flow.startFile(state('SETTINGS_MENU', { flowId: 'menu' }), 'chat-1');
    expect(t.listRecentSpreadsheets).toHaveBeenCalledWith('token', 'google');
    const write = t.transition.mock.calls[0]?.[0] as unknown as {
      targetState: string;
      payload: Record<string, unknown>;
    };
    expect(write.targetState).toBe('SETTINGS_FILE');
    expect(write.payload).toMatchObject({ sourceConfigId: config.id, origin: 'file' });
    expect(t.sendMessage).toHaveBeenCalledWith('chat-1', expect.stringContaining('New Expenses'));
  });

  it('requires Drive discovery and Sheets scopes when starting a file change', async () => {
    const t = setup();
    await t.flow.startFile(state('SETTINGS_MENU', { flowId: 'menu' }), 'chat-1');
    expect(t.tokenService.getValidAccessToken).toHaveBeenCalledWith({
      userId: 'user-1',
      provider: 'google',
      requiredScopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    });
  });

  it('searches files and replaces the displayed list under the observed revision', async () => {
    const t = setup();
    await t.flow.reply(state('SETTINGS_FILE', filePayload), 'buscar viaje', 'chat-1');
    expect(t.searchSpreadsheets).toHaveBeenCalledWith('token', 'google', 'viaje');
    const write = t.transition.mock.calls[0]?.[0] as unknown as {
      targetState: string;
      expected: { revision: string };
      payload: { files: unknown[] };
    };
    expect(write).toMatchObject({ targetState: 'SETTINGS_FILE', expected: { revision: '3' } });
    expect(write.payload.files).toEqual([{ id: 'file-searched', name: 'Searched' }]);
  });

  it('selects a displayed file and lists its sheets without changing the active configuration', async () => {
    const t = setup();
    await t.flow.reply(state('SETTINGS_FILE', filePayload), '2', 'chat-1');
    expect(t.validateFileAccess).toHaveBeenCalledWith('file-other', 'token', 'google');
    expect(t.listSheets).toHaveBeenCalledWith('file-other');
    const write = t.transition.mock.calls[0]?.[0] as unknown as {
      targetState: string;
      payload: Record<string, unknown>;
    };
    expect(write.targetState).toBe('SETTINGS_SHEET');
    expect(write.payload).toMatchObject({ fileId: 'file-other', fileName: 'Other Expenses' });
    expect(t.activate).not.toHaveBeenCalled();
  });

  it('discards proposal data when moving from file discovery to another file', async () => {
    const t = setup();
    await t.flow.reply(
      state('SETTINGS_FILE', {
        ...filePayload,
        proposalId: 'older-proposal',
        mappings: [{ field: 'monto', columnIndex: 0, columnHeader: 'Amount' }],
        categories: [{ name: 'Old', subcategories: [] }],
      }),
      '2',
      'chat-1',
    );
    const write = t.transition.mock.calls[0]?.[0] as unknown as {
      payload: Record<string, unknown>;
    };
    const next = write.payload;
    expect(next).not.toHaveProperty('proposalId');
    expect(next).not.toHaveProperty('mappings');
    expect(next).not.toHaveProperty('categories');
  });

  it('keeps the file candidate when the selected file has no sheets', async () => {
    const t = setup();
    t.listSheets.mockResolvedValue([]);
    await t.flow.reply(state('SETTINGS_FILE', filePayload), '1', 'chat-1');
    expect(t.transition).not.toHaveBeenCalled();
    expect(t.sendMessage).toHaveBeenCalledWith('chat-1', expect.stringContaining('no tiene hojas'));
  });

  it('accepts a direct Sheets link but rejects an inaccessible file', async () => {
    const t = setup();
    t.validateFileAccess.mockResolvedValue(false);
    await t.flow.reply(
      state('SETTINGS_FILE', filePayload),
      'https://docs.google.com/spreadsheets/d/link_7/edit',
      'chat-1',
    );
    expect(t.validateFileAccess).toHaveBeenCalledWith('link_7', 'token', 'google');
    expect(t.transition).not.toHaveBeenCalled();
    expect(t.activate).not.toHaveBeenCalled();
  });

  it('does not send a sheet list when a stale file selection loses its revision', async () => {
    const t = setup();
    t.transition.mockRejectedValue(new Error('stale'));
    await expect(t.flow.reply(state('SETTINGS_FILE', filePayload), '1', 'chat-1')).rejects.toThrow(
      'stale',
    );
    expect(t.sendMessage).not.toHaveBeenCalled();
    expect(t.activate).not.toHaveBeenCalled();
  });

  it('always remaps a different file even when the user answers yes', async () => {
    const t = setup();
    await t.flow.reply(
      state('SETTINGS_MAPPING', {
        ...payload,
        origin: 'file',
        fileId: 'file-new',
        step: 'same-columns',
      }),
      'sí',
      'chat-1',
    );
    expect(t.infer).toHaveBeenCalledOnce();
    expect(t.findBySpreadsheetId).not.toHaveBeenCalled();
  });

  it('rejects a read-only sheet in a different file before activation', async () => {
    const t = setup();
    t.validateSpreadsheetAccess.mockResolvedValue({ kind: 'read-only', preview });
    await t.flow.reply(
      state('SETTINGS_SHEET', { ...filePayload, sheets, fileId: 'file-new' }),
      '1',
      'chat-1',
    );
    expect(t.transition).not.toHaveBeenCalled();
    expect(t.activate).not.toHaveBeenCalled();
  });

  it('cancels a file candidate with a guarded payload clear', async () => {
    const t = setup();
    await t.flow.reply(state('SETTINGS_FILE', filePayload), 'cancelar', 'chat-1');
    expect(t.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        targetState: 'IDLE',
        payload: null,
        expected: { revision: '3', currentState: 'SETTINGS_FILE', expiry: 'unexpired' },
      }),
    );
  });

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
    expect(t.activate).not.toHaveBeenCalled();
    expect(t.detectPaymentMethods).toHaveBeenCalledOnce();
    await t.flow.reply(
      state('SETTINGS_CATEGORIES', {
        ...reviewed,
        stage: 'payment_methods',
        paymentMethods: ['Visa'],
        paymentColumnMapped: true,
      }),
      'confirmar',
      'chat-1',
    );
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
    await t.flow.reply(
      state('SETTINGS_CATEGORIES', {
        ...reviewed,
        stage: 'payment_methods',
        paymentMethods: ['Visa'],
        paymentColumnMapped: true,
      }),
      'confirmar',
      'chat-1',
    );
    expect(t.sendMessage).not.toHaveBeenCalled();
  });

  it('retries failed detection, keeps payment edits in the proposal, and cancels without activation', async () => {
    const t = setup();
    const reviewed = {
      ...payload,
      headerRowIndex: 1,
      mappings: [{ field: 'categoria', columnIndex: 1, columnHeader: 'Category' }],
      categories: [{ name: 'Food', subcategories: [] }],
    };
    t.detectPaymentMethods.mockRejectedValueOnce(new Error('provider unavailable'));
    await t.flow.reply(state('SETTINGS_CATEGORIES', reviewed), 'confirmar', 'chat-1');
    expect(t.transition).not.toHaveBeenCalled();
    expect(t.activate).not.toHaveBeenCalled();
    expect(t.sendMessage).toHaveBeenCalledWith('chat-1', expect.stringContaining('reintentar'));

    await t.flow.reply(state('SETTINGS_CATEGORIES', reviewed), 'confirmar', 'chat-1');
    expect(t.transition).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: {
          ...reviewed,
          stage: 'payment_methods',
          paymentMethods: ['Visa'],
          paymentColumnMapped: true,
        },
      }),
    );
    const paymentReview = {
      ...reviewed,
      stage: 'payment_methods',
      paymentMethods: ['Visa'],
      paymentColumnMapped: true,
    };
    await t.flow.reply(state('SETTINGS_CATEGORIES', paymentReview), 'agregar Efectivo', 'chat-1');
    expect(t.transition.mock.calls[1]?.[0]).toMatchObject({
      payload: { paymentMethods: ['Visa', 'Efectivo'] },
    });
    expect(t.activate).not.toHaveBeenCalled();

    await t.flow.reply(state('SETTINGS_CATEGORIES', paymentReview), 'cancelar', 'chat-1');
    expect(t.transition.mock.calls[2]?.[0]).toMatchObject({ targetState: 'IDLE', payload: null });
    expect(t.activate).not.toHaveBeenCalled();
    expect(config.fileId).toBe('file-old');
  });

  it('activates a reviewed file candidate without changing the historical source', async () => {
    const t = setup();
    const reviewed = {
      ...payload,
      origin: 'file',
      fileId: 'file-new',
      fileName: 'New Expenses',
      headerRowIndex: 1,
      mappings: [{ field: 'categoria', columnIndex: 1, columnHeader: 'Category' }],
      categories: [{ name: 'Food', subcategories: [] }],
    };
    await t.flow.reply(state('SETTINGS_CATEGORIES', reviewed), 'confirmar', 'chat-1');
    await t.flow.reply(
      state('SETTINGS_CATEGORIES', {
        ...reviewed,
        stage: 'payment_methods',
        paymentMethods: ['Visa'],
        paymentColumnMapped: true,
      }),
      'confirmar',
      'chat-1',
    );
    const call = t.activate.mock.calls[0]?.[0] as unknown as {
      candidate: { sourceConfigId: string; fileId: string; fileName: string };
    };
    expect(call.candidate).toMatchObject({
      sourceConfigId: 'config-old',
      fileId: 'file-new',
      fileName: 'New Expenses',
    });
    expect(config.fileId).toBe('file-old');
    expect(t.sendMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.stringContaining('planilla original'),
    );
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

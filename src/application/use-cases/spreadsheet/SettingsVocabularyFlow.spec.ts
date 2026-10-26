import { describe, expect, it, vi } from 'vitest';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { PaymentSnapshot, VocabularySnapshot } from '../../ports/SettingsVocabularyCommit';
import { RegexCategoryModificationParser } from '../../../infrastructure/adapters/RegexCategoryModificationParser';
import { SettingsVocabularyFlow, parseSettingsVocabularyPayload } from './SettingsVocabularyFlow';
import type { TransitionConversationStateInput } from '../conversation/TransitionConversationState';

const sourceConfigId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const categoryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const baseline: VocabularySnapshot = {
  categories: [{ id: categoryId, name: 'Food', normalizedName: 'food', isActive: true }],
  subcategories: [],
};
const state = (payload: Record<string, unknown> | null): ConversationState => ({
  userId: 'user-1',
  revision: '4',
  currentState: 'SETTINGS_MENU',
  statePayload: payload,
  enteredAt: new Date(),
  updatedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
});

function setup() {
  const execute = vi
    .fn<(input: TransitionConversationStateInput) => Promise<{ status: 'updated' }>>()
    .mockResolvedValue({ status: 'updated' });
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue('committed');
  const loadPayments = vi.fn().mockResolvedValue({ confirmed: false, methods: [] });
  const detectPaymentMethods = vi.fn().mockResolvedValue({ names: ['Visa'], columnMapped: true });
  const flow = new SettingsVocabularyFlow({
    configRepository: {
      findByUserId: vi.fn().mockResolvedValue({
        id: sourceConfigId,
        isActive: true,
        fileId: 'file',
        sheetName: 'sheet',
        provider: 'google',
        headerRowIndex: 2,
      }),
    } as never,
    mappingRepository: { findBySpreadsheetId: vi.fn().mockResolvedValue([]) } as never,
    parser: new RegexCategoryModificationParser(),
    commit: { load: vi.fn().mockResolvedValue(baseline), loadPayments, execute: commit },
    transition: {
      execute,
      precondition: (observed: ConversationState) => ({
        revision: observed.revision,
        currentState: observed.currentState,
        expiry: 'unexpired',
      }),
    } as never,
    messaging: { sendMessage },
    detectPaymentMethods: { execute: detectPaymentMethods },
  });
  return { flow, execute, sendMessage, commit, loadPayments, detectPaymentMethods };
}

describe('SettingsVocabularyFlow', () => {
  it('adds detected values to a payment draft without committing the catalog', async () => {
    const { flow, execute, commit, detectPaymentMethods } = setup();
    const snapshot: PaymentSnapshot = { confirmed: false, methods: [] };
    await flow.reply({
      state: state({
        screen: 'payment_methods',
        flowId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        sourceConfigId,
        paymentColumnMapped: false,
        baseline: snapshot,
        draft: snapshot,
      }),
      externalId: 'chat',
      rawMessage: 'detectar',
    });
    expect(detectPaymentMethods).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file',
        sheetName: 'sheet',
        headerRowIndex: 2,
      }),
    );
    expect(execute.mock.calls[0]?.[0].payload).toMatchObject({
      draft: { methods: [{ name: 'Visa', normalizedName: 'visa', isActive: true }] },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('retains manual payment edits when detection fails and permits a later retry', async () => {
    const { flow, execute, commit, detectPaymentMethods, sendMessage } = setup();
    const manual = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      name: 'Cash',
      normalizedName: 'cash',
      isActive: true,
    };
    const snapshot: PaymentSnapshot = { confirmed: false, methods: [] };
    const payload = {
      screen: 'payment_methods',
      flowId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sourceConfigId,
      paymentColumnMapped: true,
      baseline: snapshot,
      draft: { confirmed: false, methods: [manual] },
    };
    detectPaymentMethods.mockRejectedValueOnce(new Error('provider unavailable'));
    await flow.reply({ state: state(payload), externalId: 'chat', rawMessage: 'detectar' });
    expect(execute).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('chat', expect.stringContaining('reintentar'));

    await flow.reply({ state: state(payload), externalId: 'chat', rawMessage: 'detectar' });
    expect(execute.mock.calls[0]?.[0].payload).toMatchObject({
      draft: { methods: [manual, { name: 'Visa', normalizedName: 'visa', isActive: true }] },
    });
    expect(commit).not.toHaveBeenCalled();
  });
  it('opens an owned draft without persisting the catalog', async () => {
    const { flow, execute, commit } = setup();
    await flow.start({
      state: state({ flowId: 'legacy' }),
      externalId: 'chat',
      kind: 'categories',
    });
    const write = execute.mock.calls[0]?.[0];
    expect(write?.targetState).toBe('SETTINGS_MENU');
    expect(write?.payload).toMatchObject({
      screen: 'categories',
      sourceConfigId,
      subcategoryColumnMapped: false,
      baseline,
      draft: baseline,
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('updates only the draft after a parsed command', async () => {
    const { flow, execute, commit } = setup();
    const payload = {
      screen: 'categories',
      flowId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sourceConfigId,
      subcategoryColumnMapped: false,
      baseline,
      draft: structuredClone(baseline),
    };
    await flow.reply({
      state: state(payload),
      externalId: 'chat',
      rawMessage: 'Food se llama Comida',
    });
    expect(execute.mock.calls[0]?.[0].payload).toMatchObject({
      draft: { categories: [{ id: categoryId, name: 'Comida' }] },
    });
    expect(commit).not.toHaveBeenCalled();
    expect(baseline.categories[0]?.name).toBe('Food');
  });

  it('commits the presented draft before announcing success', async () => {
    const { flow, commit, sendMessage } = setup();
    const payload = {
      screen: 'categories',
      flowId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sourceConfigId,
      subcategoryColumnMapped: false,
      baseline,
      draft: baseline,
    };
    await flow.reply({ state: state(payload), externalId: 'chat', rawMessage: 'confirmar' });
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ sourceConfigId, baseline, draft: baseline }),
    );
    expect(sendMessage).toHaveBeenCalledWith('chat', 'Categorías y subcategorías guardadas.');
  });

  it('does not announce success after a conflict', async () => {
    const { flow, commit, sendMessage } = setup();
    commit.mockResolvedValue('conflict');
    const payload = {
      screen: 'categories',
      flowId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sourceConfigId,
      subcategoryColumnMapped: false,
      baseline,
      draft: baseline,
    };
    await flow.reply({ state: state(payload), externalId: 'chat', rawMessage: 'confirmar' });
    expect(sendMessage).not.toHaveBeenCalledWith('chat', 'Categorías y subcategorías guardadas.');
  });

  it('rejects malformed drafts and normalizes legacy menu payloads', async () => {
    const { flow, execute, commit } = setup();
    expect(parseSettingsVocabularyPayload({ flowId: 'legacy' })).toEqual({
      screen: 'menu',
      flowId: 'legacy',
    });
    await flow.reply({
      state: state({ screen: 'categories', flowId: 'x', draft: 'bad' }),
      externalId: 'chat',
      rawMessage: 'confirmar',
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ targetState: 'IDLE', payload: null }),
    );
    expect(commit).not.toHaveBeenCalled();
  });

  it('opens an unconfigured payment catalog as an empty draft with local-only guidance', async () => {
    const { flow, execute, sendMessage, commit } = setup();
    await flow.start({
      state: state({ flowId: 'legacy' }),
      externalId: 'chat',
      kind: 'payment_methods',
    });
    expect(execute.mock.calls[0]?.[0].payload).toMatchObject({
      screen: 'payment_methods',
      paymentColumnMapped: false,
      baseline: { confirmed: false, methods: [] },
      draft: { confirmed: false, methods: [] },
    });
    expect(sendMessage).toHaveBeenCalledWith(
      'chat',
      expect.stringContaining('no se escribirán en la planilla'),
    );
    expect(commit).not.toHaveBeenCalled();
  });

  it('confirms an empty payment catalog explicitly', async () => {
    const { flow, commit } = setup();
    const snapshot: PaymentSnapshot = { confirmed: false, methods: [] };
    await flow.reply({
      state: state({
        screen: 'payment_methods',
        flowId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        sourceConfigId,
        paymentColumnMapped: true,
        baseline: snapshot,
        draft: snapshot,
      }),
      externalId: 'chat',
      rawMessage: 'confirmar',
    });
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'payment_methods', draft: snapshot }),
    );
  });

  it('keeps payment edits in the draft until confirmation', async () => {
    const { flow, execute, commit } = setup();
    const snapshot: PaymentSnapshot = { confirmed: false, methods: [] };
    await flow.reply({
      state: state({
        screen: 'payment_methods',
        flowId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        sourceConfigId,
        paymentColumnMapped: true,
        baseline: snapshot,
        draft: snapshot,
      }),
      externalId: 'chat',
      rawMessage: 'agregar Visa',
    });
    expect(execute.mock.calls[0]?.[0].payload).toMatchObject({
      draft: { methods: [{ name: 'Visa', normalizedName: 'visa', isActive: true }] },
    });
    expect(commit).not.toHaveBeenCalled();
  });
});

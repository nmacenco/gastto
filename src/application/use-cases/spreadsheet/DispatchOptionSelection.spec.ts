import { describe, expect, it, vi } from 'vitest';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';
import { ResolveOptionReference } from '../../services/semantic-router/ResolveOptionReference';
import { DispatchOptionSelection } from './DispatchOptionSelection';

const files = [
  {
    id: 'provider-file-1',
    name: 'Gastos 2026',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    modifiedAt: '2026-09-17T10:00:00.000Z',
  },
  {
    id: 'provider-file-2',
    name: 'Presupuesto',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    modifiedAt: '2026-09-17T09:00:00.000Z',
  },
];
const sheets = [
  { name: 'Resumen', index: 0 },
  { name: 'Gastos', index: 1 },
];

function state(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    userId: 'user-1',
    revision: '4',
    currentState: 'ONBOARDING_FILE',
    statePayload: { fileList: files },
    enteredAt: new Date('2026-09-17T10:00:00.000Z'),
    expiresAt: null,
    updatedAt: new Date('2026-09-17T10:00:00.000Z'),
    ...overrides,
  };
}

function input(userReference: string) {
  return {
    userId: 'user-1',
    externalId: 'chat-1',
    channel: 'telegram' as const,
    conversationState: state(),
    expected: { revision: '4', currentState: 'ONBOARDING_FILE', expiry: 'unexpired' as const },
    snapshot: {
      revision: '4',
      state: 'ONBOARDING_FILE' as const,
      substep: null,
      options: files.map((file, index) => ({ position: index + 1, label: file.name })),
    },
    decision: { action: 'select_option' as const, userReference },
  };
}

function sheetState(step?: 'idk'): ConversationState {
  return state({
    currentState: 'ONBOARDING_SHEET',
    statePayload: {
      selectedFileId: 'provider-file-1',
      selectedFileName: 'Gastos 2026',
      provider: 'google',
      sheetList: sheets,
      ...(step === undefined ? {} : { step }),
    },
  });
}

function sheetInput(userReference: string, step?: 'idk') {
  return {
    ...input(userReference),
    conversationState: sheetState(step),
    expected: { revision: '4', currentState: 'ONBOARDING_SHEET', expiry: 'unexpired' as const },
    snapshot: {
      revision: '4',
      state: 'ONBOARDING_SHEET' as const,
      substep: step ?? null,
      options: sheets.map((sheet, index) => ({ position: index + 1, label: sheet.name })),
    },
  };
}

describe('DispatchOptionSelection', () => {
  it('resolves one application-owned position and performs one typed handoff', async () => {
    const selectDisplayedFile = vi.fn().mockResolvedValue({
      nextState: 'ONBOARDING_SHEET',
      message: 'selected',
    });
    const resolver = new ResolveOptionReference();
    const executeResolver = vi.spyOn(resolver, 'execute');
    const useCase = new DispatchOptionSelection({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: state() }),
      },
      resolver,
      fileSelection: { selectDisplayedFile },
      sheetSelection: { selectDisplayedSheet: vi.fn() },
    });

    await expect(useCase.execute(input('Presupuesto'))).resolves.toEqual({
      status: 'selected',
      target: 'file',
    });
    expect(selectDisplayedFile).toHaveBeenCalledOnce();
    expect(executeResolver).toHaveBeenCalledOnce();
    expect(selectDisplayedFile).toHaveBeenCalledWith(
      expect.objectContaining({ position: 2, expected: input('x').expected }),
    );
  });

  it('rejects ambiguous, unavailable and stale references without a selection effect', async () => {
    const selectDisplayedFile = vi.fn();
    const current = state({
      statePayload: {
        fileList: [
          { ...files[0], name: 'Gastos' },
          { ...files[1], name: 'Gástos' },
        ],
      },
    });
    const useCase = new DispatchOptionSelection({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: current }),
      },
      resolver: new ResolveOptionReference(),
      fileSelection: { selectDisplayedFile },
      sheetSelection: { selectDisplayedSheet: vi.fn() },
    });
    const duplicate = input('gastos');
    duplicate.snapshot = {
      ...duplicate.snapshot,
      options: [
        { position: 1, label: 'Gastos' },
        { position: 2, label: 'Gástos' },
      ],
    };
    await expect(useCase.execute(duplicate)).resolves.toEqual({
      status: 'clarification_required',
      reason: 'ambiguous_reference',
    });

    const notFound = new DispatchOptionSelection({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: state() }),
      },
      resolver: new ResolveOptionReference(),
      fileSelection: { selectDisplayedFile },
      sheetSelection: { selectDisplayedSheet: vi.fn() },
    });
    await expect(notFound.execute(input('archivo inexistente'))).resolves.toEqual({
      status: 'clarification_required',
      reason: 'not_found',
    });
    const stale = new DispatchOptionSelection({
      snapshotValidator: { execute: vi.fn().mockResolvedValue({ status: 'stale' }) },
      resolver: new ResolveOptionReference(),
      fileSelection: { selectDisplayedFile },
      sheetSelection: { selectDisplayedSheet: vi.fn() },
    });
    await expect(stale.execute(input('1'))).resolves.toEqual({
      status: 'clarification_required',
      reason: 'stale_context',
    });
    expect(selectDisplayedFile).not.toHaveBeenCalled();
  });

  it('maps a revision change during access validation to stale guidance', async () => {
    const useCase = new DispatchOptionSelection({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: state() }),
      },
      resolver: new ResolveOptionReference(),
      fileSelection: {
        selectDisplayedFile: vi
          .fn()
          .mockRejectedValue(new StaleConversationStateError({ status: 'stale' })),
      },
      sheetSelection: { selectDisplayedSheet: vi.fn() },
    });
    await expect(useCase.execute(input('primero'))).resolves.toEqual({
      status: 'clarification_required',
      reason: 'stale_context',
    });
  });

  it.each([undefined, 'idk'] as const)(
    'resolves one application-owned sheet position in the %s substep',
    async (step) => {
      const selectDisplayedFile = vi.fn();
      const selectDisplayedSheet = vi.fn().mockResolvedValue({
        nextState: 'ONBOARDING_VALIDATING_ACCESS',
        message: 'selected',
      });
      const useCase = new DispatchOptionSelection({
        snapshotValidator: {
          execute: vi.fn().mockResolvedValue({ status: 'current', state: sheetState(step) }),
        },
        resolver: new ResolveOptionReference(),
        fileSelection: { selectDisplayedFile },
        sheetSelection: { selectDisplayedSheet },
      });

      await expect(useCase.execute(sheetInput('Gastos', step))).resolves.toEqual({
        status: 'selected',
        target: 'sheet',
      });
      expect(selectDisplayedFile).not.toHaveBeenCalled();
      expect(selectDisplayedSheet).toHaveBeenCalledOnce();
      expect(selectDisplayedSheet).toHaveBeenCalledWith(
        expect.objectContaining({
          position: 2,
          expected: sheetInput('x', step).expected,
        }),
      );
    },
  );

  it('rejects duplicate normalized sheet names without either typed handoff', async () => {
    const duplicateState = sheetState();
    duplicateState.statePayload = {
      ...duplicateState.statePayload,
      sheetList: [
        { name: 'Gastos', index: 0 },
        { name: 'Gástos', index: 1 },
      ],
    };
    const selectDisplayedFile = vi.fn();
    const selectDisplayedSheet = vi.fn();
    const useCase = new DispatchOptionSelection({
      snapshotValidator: {
        execute: vi.fn().mockResolvedValue({ status: 'current', state: duplicateState }),
      },
      resolver: new ResolveOptionReference(),
      fileSelection: { selectDisplayedFile },
      sheetSelection: { selectDisplayedSheet },
    });
    const selection = sheetInput('gastos');
    selection.snapshot = {
      ...selection.snapshot,
      options: [
        { position: 1, label: 'Gastos' },
        { position: 2, label: 'Gástos' },
      ],
    };

    await expect(useCase.execute(selection)).resolves.toEqual({
      status: 'clarification_required',
      reason: 'ambiguous_reference',
    });
    expect(selectDisplayedFile).not.toHaveBeenCalled();
    expect(selectDisplayedSheet).not.toHaveBeenCalled();
  });
});

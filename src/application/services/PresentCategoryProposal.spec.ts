import { describe, expect, it, vi } from 'vitest';
import { TransitionConversationState } from '../use-cases/conversation/TransitionConversationState';
import type { IConversationStateRepository } from '../../domain/ports/repositories';
import type { FsmState } from '../../domain/entities/ConversationState';
import { presentCategoryProposal } from './PresentCategoryProposal';
import {
  isCategoryProposalPresented,
  isCategoryProposalAccepted,
  serializeCategoryOnboardingState,
  parseCategoryOnboardingState,
} from '../dtos/CategoryOnboardingState';
import {
  buildCategoryConversationState,
  buildPresentedCategoryPayload,
  buildConfirmedMappings,
} from '../../__tests__/factories/onboarding';
import { ConfirmCategories } from '../use-cases/spreadsheet/ConfirmCategories';
import type { ConfirmCategoriesDeps } from '../use-cases/spreadsheet/ConfirmCategories';
import type { MessagingOutputPort } from '../ports/output/messaging.port';

function setup() {
  let current = buildCategoryConversationState(null);
  const write = vi
    .fn()
    .mockImplementation(
      (input: { nextState: FsmState; payload: Record<string, unknown> | null }) => {
        current = {
          ...current,
          currentState: input.nextState,
          statePayload: input.payload,
          revision: String(Number(current.revision) + 1),
        };
        return Promise.resolve({ status: 'updated', state: current });
      },
    );
  const transition = new TransitionConversationState({
    transition: write,
    findByUserId: vi.fn().mockImplementation(() => Promise.resolve(current)),
  } as unknown as IConversationStateRepository);
  const send = vi.fn<MessagingOutputPort['sendMessage']>().mockResolvedValue({ status: 'success' });
  const payload = buildPresentedCategoryPayload({ categories: ['Food'] });
  const run = () =>
    transition.runForUser('user-123', () =>
      presentCategoryProposal(
        { transitionState: transition, messagingPort: { sendMessage: send } },
        { userId: 'user-123', externalId: 'chat', payload, message: 'Food; confirmar' },
      ),
    );
  const detect = vi.fn().mockResolvedValue({ names: ['Visa'], columnMapped: true });
  const commit = vi.fn();
  const save = vi.fn();
  const activate = vi.fn();
  const config = {
    id: 'config-1',
    userId: 'user-123',
    isActive: true,
    provider: 'google',
    fileId: 'file-123',
    sheetName: 'Gastos',
    headerRowIndex: 1,
  };
  const confirm = new ConfirmCategories({
    transitionState: transition,
    messagingPort: { sendMessage: send },
    spreadsheetConfigRepository: { findByUserId: vi.fn().mockResolvedValue(config) },
    columnMappingRepository: {
      findBySpreadsheetId: vi.fn().mockResolvedValue(buildConfirmedMappings()),
    },
    categoryVocabularyRepository: { findBySpreadsheetId: vi.fn(), save },
    userRepository: { updateStatus: activate },
    detectPaymentMethods: { execute: detect },
    onboardingCommit: { execute: commit },
  } as unknown as ConfirmCategoriesDeps);
  const reply = () =>
    transition.runForUser('user-123', () =>
      confirm.execute({
        userId: 'user-123',
        externalId: 'chat',
        channel: 'telegram',
        statePayload: current.statePayload,
      }),
    );
  return {
    transition,
    send,
    write,
    payload,
    run,
    reply,
    detect,
    commit,
    save,
    activate,
    state: () => current,
  };
}

describe('category proposal presentation', () => {
  it('stores an unpresented draft before delivery, then records evidence at that revision', async () => {
    const h = setup();
    h.send.mockImplementation(() => {
      expect(h.state().statePayload?.categoryPresentation).toBeNull();
      expect(h.state().statePayload?.paymentReview).toBeUndefined();
      return Promise.resolve({ status: 'success' });
    });
    await h.run();
    expect(isCategoryProposalPresented(h.state().statePayload)).toBe(true);
    expect(isCategoryProposalAccepted(h.state().statePayload)).toBe(false);
    expect(h.write.mock.calls[1]?.[0]).toMatchObject({
      expected: { revision: '2', currentState: 'ONBOARDING_CATEGORIES' },
    });
  });

  it.each(['returned-failure', 'thrown-error'] as const)(
    'does not authorize confirmation after %s; a reply re-presents and waits',
    async (failure) => {
      const h = setup();
      if (failure === 'returned-failure')
        h.send.mockResolvedValueOnce({ status: 'failure', errorCode: 'NETWORK_ERROR' });
      else h.send.mockRejectedValueOnce(new Error('delivery interrupted'));
      if (failure === 'returned-failure') await h.run();
      else await expect(h.run()).rejects.toThrow('delivery interrupted');
      expect(isCategoryProposalPresented(h.state().statePayload)).toBe(false);
      await h.reply();
      expect(isCategoryProposalPresented(h.state().statePayload)).toBe(true);
      expect(h.detect).not.toHaveBeenCalled();
      expect(h.commit).not.toHaveBeenCalled();
      expect(h.save).not.toHaveBeenCalled();
      expect(h.activate).not.toHaveBeenCalled();
      await h.reply();
      expect(h.detect).toHaveBeenCalledOnce();
      expect(isCategoryProposalAccepted(h.state().statePayload)).toBe(true);
      expect(h.commit).not.toHaveBeenCalled();
    },
  );

  it('leaves a crash between delivery and evidence recoverable', async () => {
    const h = setup();
    h.write
      .mockImplementationOnce((input: { payload: Record<string, unknown> }) =>
        Promise.resolve({
          status: 'updated',
          state: buildCategoryConversationState(input.payload, '2'),
        }),
      )
      .mockRejectedValueOnce(new Error('crash after sending'));
    await expect(h.run()).rejects.toThrow('crash after sending');
    expect(h.send).toHaveBeenCalledOnce();
    const draft = (h.write.mock.calls[0]?.[0] as { payload: Record<string, unknown> }).payload;
    expect(isCategoryProposalPresented(draft)).toBe(false);
  });

  it('does not mark a stale presentation update as delivered', async () => {
    const h = setup();
    h.send.mockImplementation(() => {
      h.write.mockResolvedValueOnce({ status: 'stale' });
      return Promise.resolve({ status: 'success' });
    });
    await expect(h.run()).rejects.toHaveProperty('name', 'StaleConversationStateError');
    expect(isCategoryProposalPresented(h.state().statePayload)).toBe(false);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('invalidates old evidence when the hierarchy is changed, including serializer-only changes', async () => {
    const h = setup();
    await h.run();
    const payload = h.state().statePayload!;
    const state = parseCategoryOnboardingState(payload)!;
    const changed = serializeCategoryOnboardingState(
      { ...state, categories: [{ name: 'Other', subcategories: [] }] },
      payload,
    );
    expect(changed.categoryPresentation).toBeNull();
    expect(isCategoryProposalPresented(changed)).toBe(false);
    expect(isCategoryProposalPresented({ ...payload, fileId: 'other-file' })).toBe(false);
    expect(isCategoryProposalPresented({ ...payload, categoryProposalId: 'other-proposal' })).toBe(
      false,
    );
  });
});

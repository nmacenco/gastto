import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { ISpreadsheetConfigRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { StartSettingsReauthorization } from './StartSettingsReauthorization';
import { settingsCopies } from '../../copies/settings.copies';

const state: ConversationState = {
  userId: 'user-1',
  revision: '3',
  currentState: 'SETTINGS_MENU',
  statePayload: { flowId: 'flow-1' },
  enteredAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  updatedAt: new Date(),
};

function subject(
  config: object | null = {
    id: 'config-1',
    provider: 'google',
    fileId: 'file-1',
    sheetName: 'Gastos',
  },
) {
  const add = vi.fn().mockResolvedValue({ id: 'job-1' });
  const remove = vi.fn().mockResolvedValue(1);
  const setex = vi.fn().mockResolvedValue('OK');
  const sendMessage = vi.fn().mockResolvedValue({ status: 'success' });
  const transition = vi
    .fn()
    .mockResolvedValue({ status: 'updated', state: { ...state, revision: '4' } });
  const findByUserId = vi.fn().mockResolvedValue(config);
  const useCase = new StartSettingsReauthorization({
    oauthService: {
      buildAuthUrl: vi.fn().mockReturnValue('https://google.example/auth'),
      exchangeCode: vi.fn(),
      refreshAccessToken: vi.fn(),
    },
    configRepository: { findByUserId } as unknown as ISpreadsheetConfigRepository,
    redis: { setex } as unknown as Redis,
    reminderQueue: { add, remove } as unknown as Queue,
    transitionState: {
      execute: transition,
      precondition: (current: ConversationState, expiry: string) => ({
        revision: current.revision,
        currentState: current.currentState,
        expiry,
      }),
    } as unknown as TransitionConversationState,
    messagingPort: { sendMessage },
    redirectUri: 'https://app.example/auth/google/callback',
    generateState: () => 'new-nonce',
  });
  return { useCase, add, remove, setex, sendMessage, transition, findByUserId };
}

describe('StartSettingsReauthorization', () => {
  const input = { state, externalId: 'chat-1', channel: 'telegram' as const };

  it('binds the destination, flow, nonce, revision and deadline before sending a link', async () => {
    const { useCase, add, setex, sendMessage, transition } = subject();
    await useCase.execute(input);
    expect(add).toHaveBeenCalledWith(
      'oauth-reminder',
      {
        userId: 'user-1',
        externalId: 'chat-1',
        channel: 'telegram',
        state: 'new-nonce',
      },
      { delay: 600_000 },
    );
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        targetState: 'SETTINGS_OAUTH',
        expected: { revision: '3', currentState: 'SETTINGS_MENU', expiry: 'unexpired' },
        payload: {
          origin: 'settings',
          flowId: 'flow-1',
          provider: 'google',
          sourceConfigId: 'config-1',
          fileId: 'file-1',
          sheetName: 'Gastos',
          state: 'new-nonce',
          reminderJobId: 'job-1',
        },
      }),
    );
    expect(setex).toHaveBeenCalledWith(
      'oauth:state:new-nonce',
      900,
      JSON.stringify({
        userId: 'user-1',
        provider: 'google',
        externalId: 'chat-1',
        channel: 'telegram',
        reminderJobId: 'job-1',
        revision: '4',
        origin: 'settings',
        flowId: 'flow-1',
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'chat-1',
      settingsCopies.authLink('https://google.example/auth'),
    );
  });

  it('keeps menu ownership and gives onboarding guidance without a destination', async () => {
    const { useCase, transition, add, sendMessage } = subject(null);
    await useCase.execute(input);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        targetState: 'SETTINGS_MENU',
        expected: { revision: '3', currentState: 'SETTINGS_MENU', expiry: 'unexpired' },
      }),
    );
    expect(add).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('chat-1', settingsCopies.destinationRequired());
  });

  it('removes an unsent reminder when the guarded transition fails', async () => {
    const { useCase, transition, remove, setex, sendMessage } = subject();
    transition.mockRejectedValue(new Error('stale'));
    await expect(useCase.execute(input)).rejects.toThrow('stale');
    expect(remove).toHaveBeenCalledWith('job-1');
    expect(setex).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

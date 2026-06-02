// LAYER: Application / Tests
// Unit tests for InitiateCloudConnection use case.
// Mocks OAuthServicePort, TransitionConversationState, MessagingOutputPort,
// Redis (setex), and BullMQ Queue.add.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InitiateCloudConnection,
  type InitiateCloudConnectionDeps,
  type InitiateCloudConnectionInput,
} from './InitiateCloudConnection';
import type { OAuthServicePort } from '../../../domain/ports/oauth';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { Redis } from 'ioredis';
import type { Queue, Job } from 'bullmq';

const mockBuildAuthUrl = vi.fn();
const mockTransitionExecute = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
const mockRedisSetex = vi.fn().mockResolvedValue('OK');
const mockQueueAdd = vi.fn();

function buildMockDeps(
  overrides: Partial<InitiateCloudConnectionDeps> = {},
): InitiateCloudConnectionDeps {
  return {
    oauthService: { buildAuthUrl: mockBuildAuthUrl } as unknown as OAuthServicePort,
    redis: { setex: mockRedisSetex } as unknown as Redis,
    reminderQueue: { add: mockQueueAdd } as unknown as Queue,
    transitionState: { execute: mockTransitionExecute } as unknown as TransitionConversationState,
    messagingPort: { sendMessage: mockSendMessage },
    redirectUri: 'http://localhost:3000/oauth/callback',
    generateState: () => 'test-state-123',
    ...overrides,
  };
}

const baseInput: InitiateCloudConnectionInput = {
  userId: 'user-123',
  rawMessage: '1',
  externalId: '123456789',
  channel: 'telegram',
};

describe('InitiateCloudConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildAuthUrl.mockReturnValue(
      'https://accounts.google.com/o/oauth2/v2/auth?state=test-state-123',
    );
    mockQueueAdd.mockResolvedValue({ id: 'job-123' } as Job);
  });

  describe('valid Google Drive selection', () => {
    it('generates auth URL, stores state, schedules reminder, transitions FSM, and sends link', async () => {
      const deps = buildMockDeps();
      const useCase = new InitiateCloudConnection(deps);
      const result = await useCase.execute(baseInput);

      expect(mockBuildAuthUrl).toHaveBeenCalledWith('google', 'test-state-123', deps.redirectUri);
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'oauth-reminder',
        { userId: 'user-123', externalId: '123456789', channel: 'telegram' },
        { delay: 600000 },
      );
      expect(mockRedisSetex).toHaveBeenCalledWith(
        'oauth:state:test-state-123',
        900,
        JSON.stringify({
          userId: 'user-123',
          provider: 'google',
          externalId: '123456789',
          channel: 'telegram',
          reminderJobId: 'job-123',
        }),
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('https://accounts.google.com/o/oauth2/v2/auth'),
      );
      expect(mockTransitionExecute).toHaveBeenCalledWith({
        userId: 'user-123',
        targetState: 'ONBOARDING_DRIVE',
        payload: { provider: 'google', state: 'test-state-123' },
      });

      expect(result.nextState).toBe('ONBOARDING_DRIVE');
      expect(result.message).toContain('autorizar a Gastto');
      expect(result.payload).toEqual({ provider: 'google', state: 'test-state-123' });
    });

    it.each([['1'], ['google drive'], ['Google Drive'], ['GOOGLE'], ['drive'], ['gdrive']])(
      'accepts "%s" as Google Drive',
      async (rawMessage) => {
        const deps = buildMockDeps();
        const useCase = new InitiateCloudConnection(deps);
        const result = await useCase.execute({ ...baseInput, rawMessage });

        expect(result.nextState).toBe('ONBOARDING_DRIVE');
        expect(mockBuildAuthUrl).toHaveBeenCalled();
      },
    );
  });

  describe('OneDrive selection', () => {
    it.each([['2'], ['onedrive'], ['OneDrive'], ['microsoft'], ['office 365']])(
      'returns coming-soon message for "%s" without side effects',
      async (rawMessage) => {
        const deps = buildMockDeps();
        const useCase = new InitiateCloudConnection(deps);
        const result = await useCase.execute({ ...baseInput, rawMessage });

        expect(result.nextState).toBe('ONBOARDING_START');
        expect(result.message).toBe(
          'OneDrive está en camino 🚧. Escribí _1_ para usar Google Drive por ahora.',
        );
        expect(mockSendMessage).toHaveBeenCalledWith('123456789', result.message);
        expect(mockBuildAuthUrl).not.toHaveBeenCalled();
        expect(mockQueueAdd).not.toHaveBeenCalled();
        expect(mockRedisSetex).not.toHaveBeenCalled();
        expect(mockTransitionExecute).not.toHaveBeenCalled();
      },
    );
  });

  describe('invalid input', () => {
    it.each([['3'], ['dropbox'], [''], ['   '], ['maybe']])(
      'returns re-prompt for "%s" without side effects',
      async (rawMessage) => {
        const deps = buildMockDeps();
        const useCase = new InitiateCloudConnection(deps);
        const result = await useCase.execute({ ...baseInput, rawMessage });

        expect(result.nextState).toBe('ONBOARDING_START');
        expect(result.message).toBe(
          'No entendí. Escribí _1_ para Google Drive o _2_ para OneDrive.',
        );
        expect(mockSendMessage).toHaveBeenCalledWith('123456789', result.message);
        expect(mockBuildAuthUrl).not.toHaveBeenCalled();
        expect(mockQueueAdd).not.toHaveBeenCalled();
        expect(mockRedisSetex).not.toHaveBeenCalled();
        expect(mockTransitionExecute).not.toHaveBeenCalled();
      },
    );
  });

  describe('missing or empty message', () => {
    it('returns re-prompt for empty string', async () => {
      const deps = buildMockDeps();
      const useCase = new InitiateCloudConnection(deps);
      const result = await useCase.execute({ ...baseInput, rawMessage: '' });

      expect(result.nextState).toBe('ONBOARDING_START');
      expect(result.message).toBe('No entendí. Escribí _1_ para Google Drive o _2_ para OneDrive.');
      expect(mockBuildAuthUrl).not.toHaveBeenCalled();
    });

    it('returns re-prompt for whitespace-only string', async () => {
      const deps = buildMockDeps();
      const useCase = new InitiateCloudConnection(deps);
      const result = await useCase.execute({ ...baseInput, rawMessage: '   \n\t  ' });

      expect(result.nextState).toBe('ONBOARDING_START');
      expect(result.message).toBe('No entendí. Escribí _1_ para Google Drive o _2_ para OneDrive.');
    });
  });

  describe('fallback job id when BullMQ returns undefined id', () => {
    it('uses a fallback job id when BullMQ job id is missing', async () => {
      mockQueueAdd.mockResolvedValue({ id: undefined });

      const deps = buildMockDeps();
      const useCase = new InitiateCloudConnection(deps);
      await useCase.execute(baseInput);

      const redisCallArgs = mockRedisSetex.mock.calls[0] as [string, number, string];
      expect(redisCallArgs).toBeDefined();
      const storedValue = JSON.parse(redisCallArgs[2]) as { reminderJobId: string };
      expect(storedValue.reminderJobId).toMatch(/^fallback-\d+$/);
    });
  });
});

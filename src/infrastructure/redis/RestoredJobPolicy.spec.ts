import { describe, expect, it } from 'vitest';
import { classifyRestoredJob, type RestoredJobContext } from './RestoredJobPolicy';

const userId = '11111111-1111-4111-8111-111111111111';
const deletedId = '22222222-2222-4222-8222-222222222222';
const context: RestoredJobContext = {
  liveUsers: new Set([userId]),
  deletingUsers: new Set([deletedId]),
  ownerByIdentity: new Map([['identity:telegram:live-chat', userId]]),
  conversationByUser: new Map([
    [userId, { currentState: 'ONBOARDING_DRIVE', statePayload: null, expiresAt: null }],
  ]),
};

const processing = {
  userId,
  rawMessage: 'private message',
  channel: 'telegram',
  externalId: 'live-chat',
  externalMessageId: 'message-1',
  receivedAt: '2026-11-22T12:00:00.000Z',
};

describe('restored job decisions', () => {
  it('keeps current-account work pending until its outcome is known', () => {
    expect(classifyRestoredJob('process-message', processing, 'waiting', context)).toBe(
      'unresolved',
    );
    expect(classifyRestoredJob('process-message', processing, 'completed', context)).toBe(
      'completedHistory',
    );
    expect(classifyRestoredJob('process-message', processing, 'failed', context)).toBe(
      'failedHistory',
    );
    expect(
      classifyRestoredJob(
        'oauth-reminder',
        { userId, externalId: 'live-chat', channel: 'telegram' },
        'delayed',
        context,
      ),
    ).toBe('unresolved');
  });

  it('flags jobs whose owner or messaging identity is no longer current', () => {
    expect(
      classifyRestoredJob(
        'process-message',
        { ...processing, userId: deletedId },
        'waiting',
        context,
      ),
    ).toBe('orphaned');
    expect(
      classifyRestoredJob(
        'process-message',
        { ...processing, externalId: 'old-chat' },
        'waiting',
        context,
      ),
    ).toBe('orphaned');
  });

  it('uses current PostgreSQL flow state to identify obsolete OAuth reminders', () => {
    const reminder = { userId, externalId: 'live-chat', channel: 'telegram' };
    const idle: RestoredJobContext = {
      ...context,
      conversationByUser: new Map([
        [userId, { currentState: 'IDLE', statePayload: null, expiresAt: null }],
      ]),
    };
    expect(classifyRestoredJob('oauth-reminder', reminder, 'delayed', idle)).toBe(
      'obsoleteReminder',
    );
    expect(classifyRestoredJob('oauth-reminder', reminder, 'active', idle)).toBe('unresolved');

    const settings: RestoredJobContext = {
      ...context,
      conversationByUser: new Map([
        [
          userId,
          {
            currentState: 'SETTINGS_OAUTH',
            statePayload: { state: 'current-nonce' },
            expiresAt: new Date(Date.now() + 60_000),
          },
        ],
      ]),
    };
    expect(
      classifyRestoredJob(
        'oauth-reminder',
        { ...reminder, state: 'old-nonce' },
        'delayed',
        settings,
      ),
    ).toBe('obsoleteReminder');
    expect(
      classifyRestoredJob(
        'oauth-reminder',
        { ...reminder, state: 'current-nonce' },
        'delayed',
        settings,
      ),
    ).toBe('unresolved');
  });

  it('separates pending deletion jobs from stale deletion jobs', () => {
    expect(classifyRestoredJob('account-deletion', { userId: deletedId }, 'waiting', context)).toBe(
      'pendingDeletion',
    );
    expect(classifyRestoredJob('account-deletion', { userId }, 'waiting', context)).toBe(
      'orphaned',
    );
    expect(classifyRestoredJob('account-deletion', { userId: 'invalid' }, 'waiting', context)).toBe(
      'invalidPayload',
    );
  });

  it('holds unknown ingress and malformed payloads without assuming an owner', () => {
    const incoming = {
      messageType: 'TEXT',
      chatId: 'new-chat',
      timestamp: '2026-11-22T12:00:00.000Z',
      channel: 'telegram',
      externalMessageId: 'message-2',
    };
    expect(classifyRestoredJob('incoming-message', incoming, 'waiting', context)).toBe(
      'unresolved',
    );
    expect(
      classifyRestoredJob(
        'incoming-message',
        { ...incoming, timestamp: 'bad' },
        'waiting',
        context,
      ),
    ).toBe('invalidPayload');
    expect(classifyRestoredJob('unknown-queue', processing, 'waiting', context)).toBe(
      'invalidPayload',
    );
  });

  it('recognizes only the empty global session-timeout payload', () => {
    expect(classifyRestoredJob('session-timeout', {}, 'waiting', context)).toBe('global');
    expect(classifyRestoredJob('session-timeout', { userId }, 'waiting', context)).toBe(
      'invalidPayload',
    );
  });
});

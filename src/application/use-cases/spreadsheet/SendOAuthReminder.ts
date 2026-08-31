// LAYER: Application
// Use case: send a reminder with a fresh OAuth auth link when the user hasn't
// completed authorization within 10 minutes. Checks whether tokens already
// exist (skips if so), generates a new CSRF state, stores it in Redis,
// schedules a new BullMQ reminder job, updates the FSM payload via self-transition,
// and resends the auth link.

import { randomBytes } from 'crypto';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { OAuthServicePort } from '../../../domain/ports/oauth';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import type { OAuthAccessTokenProvider } from '../../services/OAuthAccessTokenService';

export interface SendOAuthReminderInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  provider: SpreadsheetProvider;
  redirectUri: string;
}

export interface SendOAuthReminderOutput {
  message: string;
  nextState: FsmState;
}

export interface SendOAuthReminderDeps {
  redis: Redis;
  oauthService: OAuthServicePort;
  oauthAccessTokenService: OAuthAccessTokenProvider;
  conversationRepo: IConversationStateRepository;
  reminderQueue: Queue;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  generateState?: () => string;
}

export class SendOAuthReminder {
  constructor(private readonly deps: SendOAuthReminderDeps) {}

  async execute(input: SendOAuthReminderInput): Promise<SendOAuthReminderOutput> {
    const { userId, externalId, channel, provider, redirectUri } = input;

    try {
      await this.deps.oauthAccessTokenService.getValidAccessToken({ userId, provider });
      return { message: '', nextState: 'ONBOARDING_DRIVE' };
    } catch (error) {
      if (!(error instanceof SpreadsheetError) || error.code !== 'AUTH_ERROR') throw error;
    }

    const currentState = await this.deps.conversationRepo.findByUserId(userId);
    if (currentState?.currentState !== 'ONBOARDING_DRIVE') {
      // Stale reminder: user already cancelled, timed out, or completed OAuth.
      return { message: '', nextState: currentState?.currentState ?? 'IDLE' };
    }

    const state = (this.deps.generateState ?? (() => randomBytes(32).toString('hex')))();
    const authUrl = this.deps.oauthService.buildAuthUrl(provider, state, redirectUri);

    const reminderJob = await this.deps.reminderQueue.add(
      'oauth-reminder',
      { userId, externalId, channel },
      { delay: 10 * 60 * 1000 }, // 10 minutes
    );

    const reminderJobId = reminderJob.id ?? `fallback-${Date.now()}`;

    await this.deps.redis.setex(
      `oauth:state:${state}`,
      15 * 60, // 15 minutes
      JSON.stringify({ userId, provider, externalId, channel, reminderJobId }),
    );

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_DRIVE',
      payload: { provider, state },
    });

    const message = onboardingCopies.reminderMessage(authUrl);
    await this.deps.messagingPort.sendMessage(externalId, message);

    return { message, nextState: 'ONBOARDING_DRIVE' };
  }
}

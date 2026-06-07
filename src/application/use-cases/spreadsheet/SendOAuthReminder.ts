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
import type { IOAuthTokenRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import { onboardingCopies } from '../../copies/onboarding.copies';

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
  tokenRepository: IOAuthTokenRepository;
  reminderQueue: Queue;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  generateState?: () => string;
}

export class SendOAuthReminder {
  constructor(private readonly deps: SendOAuthReminderDeps) {}

  async execute(input: SendOAuthReminderInput): Promise<SendOAuthReminderOutput> {
    const { userId, externalId, channel, provider, redirectUri } = input;

    const existingToken = await this.deps.tokenRepository.findByUserAndProvider(userId, provider);
    if (existingToken) {
      return { message: '', nextState: 'ONBOARDING_DRIVE' };
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

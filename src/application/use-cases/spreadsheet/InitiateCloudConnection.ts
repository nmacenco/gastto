// LAYER: Application
// Use case: handle cloud provider selection during ONBOARDING_START.
// Parses the user's choice, generates an OAuth URL for Google Drive,
// stores CSRF state in Redis, schedules a reminder job, and transitions
// the conversation state. OneDrive returns a "coming soon" message.

import { randomBytes } from 'crypto';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { OAuthServicePort } from '../../../domain/ports/oauth';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import { onboardingCopies } from '../../copies/onboarding.copies';

export interface InitiateCloudConnectionInput {
  userId: string;
  rawMessage: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
}

export interface InitiateCloudConnectionOutput {
  nextState: FsmState;
  message: string;
  payload?: Record<string, unknown>;
}

export interface InitiateCloudConnectionDeps {
  oauthService: OAuthServicePort;
  redis: Redis;
  reminderQueue: Queue;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  redirectUri: string;
  generateState?: () => string;
}

function parseProviderChoice(raw: string): 'google' | 'onedrive' | 'invalid' {
  const normalized = raw.toLowerCase().trim().replace(/\s+/g, ' ');

  const googleVariants = ['1', 'google drive', 'google', 'drive', 'gdrive'];
  const onedriveVariants = ['2', 'onedrive', 'one drive', 'microsoft', 'office365', 'office 365'];

  if (googleVariants.includes(normalized)) return 'google';
  if (onedriveVariants.includes(normalized)) return 'onedrive';

  return 'invalid';
}

export class InitiateCloudConnection {
  constructor(private readonly deps: InitiateCloudConnectionDeps) {}

  async execute(input: InitiateCloudConnectionInput): Promise<InitiateCloudConnectionOutput> {
    const { userId, rawMessage, externalId, channel } = input;

    if (!rawMessage.trim()) {
      const rePrompt = onboardingCopies.invalidRePrompt();
      await this.deps.messagingPort.sendMessage(externalId, rePrompt);
      return { nextState: 'ONBOARDING_START', message: rePrompt };
    }

    const choice = parseProviderChoice(rawMessage);

    if (choice === 'onedrive') {
      const comingSoon = onboardingCopies.comingSoon('OneDrive');
      await this.deps.messagingPort.sendMessage(externalId, comingSoon);
      return { nextState: 'ONBOARDING_START', message: comingSoon };
    }

    if (choice === 'invalid') {
      const rePrompt = onboardingCopies.invalidRePrompt();
      await this.deps.messagingPort.sendMessage(externalId, rePrompt);
      return { nextState: 'ONBOARDING_START', message: rePrompt };
    }

    // Google Drive flow
    const state = (this.deps.generateState ?? (() => randomBytes(32).toString('hex')))();
    const authUrl = this.deps.oauthService.buildAuthUrl('google', state, this.deps.redirectUri);

    const reminderJob = await this.deps.reminderQueue.add(
      'oauth-reminder',
      { userId, externalId, channel },
      { delay: 10 * 60 * 1000 }, // 10 minutes
    );

    const reminderJobId = reminderJob.id ?? `fallback-${Date.now()}`;

    await this.deps.redis.setex(
      `oauth:state:${state}`,
      15 * 60, // 15 minutes
      JSON.stringify({ userId, provider: 'google', externalId, channel, reminderJobId }),
    );

    const message = onboardingCopies.authLink(authUrl);
    await this.deps.messagingPort.sendMessage(externalId, message);

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_DRIVE',
      payload: { provider: 'google', state },
    });

    return {
      nextState: 'ONBOARDING_DRIVE',
      message,
      payload: { provider: 'google', state },
    };
  }
}

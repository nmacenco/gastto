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

const INVALID_RE_PROMPT = 'No entendí. Escribí _1_ para Google Drive o _2_ para OneDrive.';
const ONEDRIVE_COMING_SOON =
  'OneDrive está en camino 🚧. Escribí _1_ para usar Google Drive por ahora.';

function buildAuthLinkMessage(authUrl: string): string {
  return `Hacé clic en este enlace para autorizar a Gastto: ${authUrl}\nTenés 10 minutos.`;
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
      await this.deps.messagingPort.sendMessage(externalId, INVALID_RE_PROMPT);
      return { nextState: 'ONBOARDING_START', message: INVALID_RE_PROMPT };
    }

    const choice = parseProviderChoice(rawMessage);

    if (choice === 'onedrive') {
      await this.deps.messagingPort.sendMessage(externalId, ONEDRIVE_COMING_SOON);
      return { nextState: 'ONBOARDING_START', message: ONEDRIVE_COMING_SOON };
    }

    if (choice === 'invalid') {
      await this.deps.messagingPort.sendMessage(externalId, INVALID_RE_PROMPT);
      return { nextState: 'ONBOARDING_START', message: INVALID_RE_PROMPT };
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

    const message = buildAuthLinkMessage(authUrl);
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

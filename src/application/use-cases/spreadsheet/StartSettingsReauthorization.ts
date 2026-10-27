import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { OAuthServicePort } from '../../../domain/ports/oauth';
import type { ISpreadsheetConfigRepository } from '../../../domain/ports/repositories';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { settingsCopies } from '../../copies/settings.copies';

export interface StartSettingsReauthorizationDeps {
  oauthService: OAuthServicePort;
  configRepository: ISpreadsheetConfigRepository;
  redis: Redis;
  reminderQueue: Queue;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  redirectUri: string;
  generateState?: () => string;
}

export class StartSettingsReauthorization {
  constructor(private readonly deps: StartSettingsReauthorizationDeps) {}

  async execute(input: {
    state: ConversationState;
    externalId: string;
    channel: 'telegram' | 'whatsapp';
  }): Promise<void> {
    const { state: observed, externalId, channel } = input;
    const flowId = observed.statePayload?.flowId;
    if (observed.currentState !== 'SETTINGS_MENU' || typeof flowId !== 'string' || !flowId) {
      throw new Error('Settings menu ownership is missing');
    }
    const config = await this.deps.configRepository.findByUserId(observed.userId);
    if (!config || config.provider !== 'google' || !config.fileId || !config.sheetName) {
      await this.deps.transitionState.execute({
        userId: observed.userId,
        targetState: 'SETTINGS_MENU',
        payload: observed.statePayload,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        expected: this.deps.transitionState.precondition(observed, 'unexpired'),
      });
      await this.deps.messagingPort.sendMessage(externalId, settingsCopies.destinationRequired());
      return;
    }
    const nonce = (this.deps.generateState ?? (() => randomBytes(32).toString('hex')))();
    const authUrl = this.deps.oauthService.buildAuthUrl('google', nonce, this.deps.redirectUri);
    const job = await this.deps.reminderQueue.add(
      'oauth-reminder',
      { userId: observed.userId, externalId, channel, state: nonce },
      { delay: 10 * 60 * 1000 },
    );
    const reminderJobId = job.id ?? `fallback-${Date.now()}`;
    let transition;
    try {
      transition = await this.deps.transitionState.execute({
        userId: observed.userId,
        targetState: 'SETTINGS_OAUTH',
        payload: {
          origin: 'settings',
          flowId,
          provider: 'google',
          sourceConfigId: config.id,
          fileId: config.fileId,
          sheetName: config.sheetName,
          state: nonce,
          reminderJobId,
        },
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        expected: this.deps.transitionState.precondition(observed, 'unexpired'),
      });
    } catch (error) {
      await this.deps.reminderQueue.remove(reminderJobId).catch(() => undefined);
      throw error;
    }
    if (transition.status !== 'updated')
      throw new Error('Settings OAuth transition was not committed');
    await this.deps.redis.setex(
      `oauth:state:${nonce}`,
      15 * 60,
      JSON.stringify({
        userId: observed.userId,
        provider: 'google',
        externalId,
        channel,
        reminderJobId,
        revision: transition.state.revision,
        origin: 'settings',
        flowId,
      }),
    );
    await this.deps.messagingPort.sendMessage(externalId, settingsCopies.authLink(authUrl));
  }
}

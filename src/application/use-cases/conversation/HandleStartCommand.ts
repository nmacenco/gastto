// LAYER: Application
// Use case: handle the /start command.
// Returns a welcome message DTO that the route layer translates into
// the appropriate HTTP response / messaging API call.

import type { IChatMessenger } from '../../ports/IChatMessenger';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import { sharedCopies } from '../../copies/shared.copies';
import type { TransitionConversationState } from './TransitionConversationState';
import type { IUserProcessingLock } from '../../ports/UserProcessingLock';
import { startUserProcessingLeaseRenewal } from '../../services/UserProcessingLease';
import type { Logger } from 'pino';

export interface HandleStartCommandInput {
  userId: string;
  chatId: string;
  username?: string | undefined;
}

export interface HandleStartCommandOutput {
  replyText: string;
}

export class HandleStartCommand {
  constructor(
    private readonly messenger: IChatMessenger,
    private readonly conversationRepo: IConversationStateRepository,
    private readonly transitionState?: TransitionConversationState,
    private readonly userProcessingLock?: IUserProcessingLock,
    private readonly logger?: Logger,
  ) {}

  async execute(input: HandleStartCommandInput): Promise<HandleStartCommandOutput> {
    if (!this.transitionState || !this.userProcessingLock) return this.executeOwned(input);
    const token = await this.userProcessingLock.acquire(input.userId, 180_000);
    if (!token) return { replyText: sharedCopies.welcome(input.username) };
    const stopRenewal = startUserProcessingLeaseRenewal({
      userId: input.userId,
      token,
      lock: this.userProcessingLock,
      transitionState: this.transitionState,
      ...(this.logger === undefined ? {} : { logger: this.logger }),
      endpoint: 'HandleStartCommand',
    });
    try {
      return await this.transitionState.runForUser(input.userId, () => this.executeOwned(input));
    } finally {
      stopRenewal();
      try {
        await this.userProcessingLock.release(input.userId, token);
      } catch (releaseError) {
        this.logger?.error({
          msg: 'Failed to release per-user processing lock',
          endpoint: 'HandleStartCommand',
          code: 'LOCK_RELEASE_FAILED',
          userId: input.userId,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
      }
    }
  }

  private async executeOwned(input: HandleStartCommandInput): Promise<HandleStartCommandOutput> {
    const welcomeText = sharedCopies.welcome(input.username);

    // The use case delegates the actual delivery to the infrastructure adapter,
    // but the *content* of the message is owned by the application layer.
    await this.messenger.sendWelcome(input.chatId, input.username);

    // Ensure the user has a valid conversation state (create if missing)
    const existingState = await this.conversationRepo.findByUserId(input.userId);
    if (!existingState) {
      await this.conversationRepo.create(input.userId);
    }

    return { replyText: welcomeText };
  }
}

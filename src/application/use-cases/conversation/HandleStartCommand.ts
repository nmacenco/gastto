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
import type { AccessRequestRepository } from '../../../domain/ports/AccessRequestRepository';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { accessCopies } from '../../copies/access.copies';
import { markAccessWelcomeShown } from './markAccessWelcomeShown';
import type { AccountExternalWorkFence } from '../../ports/AccountExternalWorkFence';
import { AccountDeletionInProgressError } from '../../ports/AccountExternalWorkFence';

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
    private readonly accessRequests?: AccessRequestRepository,
    private readonly messaging?: MessagingOutputPort,
    private readonly accountIdentity?: {
      findByMessagingIdentity(
        channel: 'telegram',
        externalId: string,
      ): Promise<{ userId: string } | null>;
      isDeleting(userId: string): Promise<boolean>;
    },
    private readonly accountExternalWorkFence?: AccountExternalWorkFence,
  ) {}

  async execute(input: HandleStartCommandInput): Promise<HandleStartCommandOutput> {
    const executeOwned = () =>
      this.accountExternalWorkFence
        ? this.accountExternalWorkFence.run(input.userId, () => this.executeOwned(input))
        : this.executeOwned(input);
    try {
      return await this.executeWithUserLock(input, executeOwned);
    } catch (error) {
      if (error instanceof AccountDeletionInProgressError) return { replyText: '' };
      throw error;
    }
  }

  private async executeWithUserLock(
    input: HandleStartCommandInput,
    executeOwned: () => Promise<HandleStartCommandOutput>,
  ): Promise<HandleStartCommandOutput> {
    if (!this.transitionState || !this.userProcessingLock) return executeOwned();
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
      return await this.transitionState.runForUser(input.userId, executeOwned);
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
    if (this.accountIdentity) {
      const current = await this.accountIdentity.findByMessagingIdentity('telegram', input.chatId);
      if (
        current?.userId !== input.userId ||
        (await this.accountIdentity.isDeleting(input.userId))
      ) {
        return { replyText: '' };
      }
    }
    if (this.accessRequests && this.messaging) {
      const approved = await this.accessRequests.findApproved(input.userId);
      const pending = approved ? null : await this.accessRequests.findPending(input.userId);
      const existingState = await this.conversationRepo.findByUserId(input.userId);
      const state = existingState ?? (await this.conversationRepo.create(input.userId));
      const showWelcome = !approved && !pending && state.statePayload?.accessWelcomeShown !== true;
      const replyText = [
        ...(showWelcome ? [accessCopies.welcome()] : []),
        approved
          ? accessCopies.approved()
          : pending
            ? accessCopies.pendingAgain()
            : accessCopies.askEmail(),
      ].join('\n\n');
      const result = await this.messaging.sendMessage(input.chatId, replyText);
      if (showWelcome && result.status === 'success' && this.transitionState) {
        await markAccessWelcomeShown(state, this.transitionState);
      }
      return { replyText };
    }
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

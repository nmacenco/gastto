// LAYER: Application
// Use case: finds expired conversation states, transitions them to IDLE,
// and notifies the user via their messaging identities.
// For EXPENSE_REVIEW it implements a two-stage timeout: one reminder, then
// auto-cancel after another grace period.
// One per-user failure must not abort the batch.

import type {
  IConversationStateRepository,
  IExpenseQueueRepository,
  IUserRepository,
} from '../../../domain/ports/repositories';
import type { Logger } from 'pino';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { ExpenseSummaryPresenter } from '../../ports/output/expense-summary.presenter';
import { type TransitionConversationState } from './TransitionConversationState';
import type { AdvancePendingExpense } from '../expense/AdvancePendingExpense';
import type { IUserProcessingLock } from '../../ports/UserProcessingLock';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import { startUserProcessingLeaseRenewal } from '../../services/UserProcessingLease';

export class HandleExpiredSessions {
  constructor(
    private readonly conversationRepo: IConversationStateRepository,
    private readonly userRepo: IUserRepository,
    private readonly transitionState: TransitionConversationState,
    private readonly messagingPort: MessagingOutputPort,
    private readonly expenseSummaryPresenterFactory: (
      messaging: MessagingOutputPort,
      chatId: string,
    ) => ExpenseSummaryPresenter,
    private readonly reminderTimeoutMinutes: number = 10,
    private readonly logger: Logger,
    private readonly expenseQueueRepository?: IExpenseQueueRepository,
    private readonly advancePendingExpense?: AdvancePendingExpense,
    private readonly userProcessingLock?: IUserProcessingLock,
  ) {}

  async execute(): Promise<void> {
    const expiredStates = await this.conversationRepo.findExpired();

    for (const state of expiredStates) {
      const lockToken = this.userProcessingLock
        ? await this.userProcessingLock.acquire(state.userId, 180_000)
        : 'unlocked';
      if (!lockToken) continue;
      const stopRenewal =
        this.userProcessingLock && lockToken !== 'unlocked'
          ? startUserProcessingLeaseRenewal({
              userId: state.userId,
              token: lockToken,
              lock: this.userProcessingLock,
              transitionState: this.transitionState,
              logger: this.logger,
              endpoint: 'HandleExpiredSessions',
            })
          : () => undefined;
      try {
        await this.transitionState.runWithState(state, async () => {
          if (state.currentState === 'EXPENSE_REVIEW') {
            await this.handleExpiredReview(state);
            return;
          }
          await this.handleGenericExpiredSession(state);
        });
      } catch (err) {
        this.logger.error({
          msg: 'Failed to process expired session',
          userId: state.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        stopRenewal();
        if (this.userProcessingLock && lockToken !== 'unlocked') {
          try {
            await this.userProcessingLock.release(state.userId, lockToken);
          } catch (releaseError) {
            this.logger.error({
              msg: 'Failed to release per-user processing lock',
              endpoint: 'HandleExpiredSessions',
              code: 'LOCK_RELEASE_FAILED',
              userId: state.userId,
              error:
                releaseError instanceof Error ? releaseError.message : String(releaseError),
            });
          }
        }
      }
    }
  }

  private async handleExpiredReview(state: ConversationState): Promise<void> {
    const { userId, statePayload: payload } = state;
    const reminderSent = payload?.reminderSent === true;

    const pendingCount = await this.expenseQueueRepository?.countByUserId(userId);
    if (!reminderSent) {
      await this.transitionState.execute({
        userId,
        targetState: 'EXPENSE_REVIEW',
        payload: { ...payload, reminderSent: true },
        expiresAt: new Date(Date.now() + this.reminderTimeoutMinutes * 60 * 1000),
        expected: this.transitionState.precondition(state, 'expired'),
      });
      await this.sendReminder(userId, pendingCount);
      return;
    }

    await this.transitionState.execute({
      userId,
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
      expected: this.transitionState.precondition(state, 'expired'),
    });
    await this.notifyCancellation(userId);
    if ((pendingCount ?? 0) > 0 && this.advancePendingExpense) {
      const identities = await this.userRepo.findMessagingIdentitiesByUserId(userId);
      const identity = identities[0];
      if (identity) {
        try {
          await this.advancePendingExpense.execute({
            userId,
            chatId: identity.externalId,
            channel: identity.channel,
            reason: 'expired',
            completedCount:
              typeof payload?.queueRegisteredCount === 'number' ? payload.queueRegisteredCount : 0,
          });
        } catch (err) {
          this.logger.error({
            msg: 'Failed to advance pending expense after review timeout',
            endpoint: 'HandleExpiredSessions',
            code: 'QUEUE_TIMEOUT_ADVANCE_FAILED',
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  private async handleGenericExpiredSession(state: ConversationState): Promise<void> {
    const { userId } = state;
    await this.transitionState.execute({
      userId,
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
      expected: this.transitionState.precondition(state, 'expired'),
    });

    const identities = await this.userRepo.findMessagingIdentitiesByUserId(userId);

    for (const identity of identities) {
      try {
        await this.messagingPort.sendMessage(
          identity.externalId,
          'Tu sesion expiro. Queres continuar o empezar de nuevo?',
        );
      } catch (err) {
        this.logger.error({
          msg: 'Failed to send session timeout message',
          userId,
          channel: identity.channel,
          externalId: identity.externalId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async sendReminder(userId: string, pendingCount?: number): Promise<void> {
    const identities = await this.userRepo.findMessagingIdentitiesByUserId(userId);

    for (const identity of identities) {
      try {
        const presenter = this.expenseSummaryPresenterFactory(
          this.messagingPort,
          identity.externalId,
        );
        await presenter.showTimeoutWarning(pendingCount);
      } catch (err) {
        this.logger.error({
          msg: 'Failed to send review timeout reminder',
          userId,
          channel: identity.channel,
          externalId: identity.externalId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async notifyCancellation(userId: string): Promise<void> {
    const identities = await this.userRepo.findMessagingIdentitiesByUserId(userId);

    for (const identity of identities) {
      try {
        const presenter = this.expenseSummaryPresenterFactory(
          this.messagingPort,
          identity.externalId,
        );
        await presenter.notifyCancellation();
      } catch (err) {
        this.logger.error({
          msg: 'Failed to send review cancellation notice',
          userId,
          channel: identity.channel,
          externalId: identity.externalId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

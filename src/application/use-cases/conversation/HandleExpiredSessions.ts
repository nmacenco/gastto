// LAYER: Application
// Use case: finds expired conversation states, transitions them to IDLE,
// and notifies the user via their messaging identities.
// For EXPENSE_REVIEW it implements a two-stage timeout: one reminder, then
// auto-cancel after another grace period.
// One per-user failure must not abort the batch.

import type {
  IConversationStateRepository,
  IUserRepository,
} from '../../../domain/ports/repositories';
import type { Logger } from 'pino';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { ExpenseSummaryPresenter } from '../../ports/output/expense-summary.presenter';
import { type TransitionConversationState } from './TransitionConversationState';

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
  ) {}

  async execute(): Promise<void> {
    const expiredStates = await this.conversationRepo.findExpired();

    for (const state of expiredStates) {
      try {
        if (state.currentState === 'EXPENSE_REVIEW') {
          await this.handleExpiredReview(state.userId, state.statePayload);
          continue;
        }

        await this.handleGenericExpiredSession(state.userId);
      } catch (err) {
        this.logger.error({
          msg: 'Failed to process expired session',
          userId: state.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async handleExpiredReview(
    userId: string,
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    const reminderSent = payload?.reminderSent === true;

    if (!reminderSent) {
      await this.sendReminder(userId);
      await this.transitionState.execute({
        userId,
        targetState: 'EXPENSE_REVIEW',
        payload: { ...payload, reminderSent: true },
        expiresAt: new Date(Date.now() + this.reminderTimeoutMinutes * 60 * 1000),
      });
      return;
    }

    await this.transitionState.execute({
      userId,
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
    });
    await this.notifyCancellation(userId);
  }

  private async handleGenericExpiredSession(userId: string): Promise<void> {
    await this.transitionState.execute({
      userId,
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
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

  private async sendReminder(userId: string): Promise<void> {
    const identities = await this.userRepo.findMessagingIdentitiesByUserId(userId);

    for (const identity of identities) {
      try {
        const presenter = this.expenseSummaryPresenterFactory(
          this.messagingPort,
          identity.externalId,
        );
        await presenter.showTimeoutWarning();
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

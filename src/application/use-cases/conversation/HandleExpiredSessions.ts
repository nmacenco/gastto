// LAYER: Application
// Use case: finds expired conversation states, transitions them to IDLE,
// and notifies the user via their messaging identities.
// One per-user failure must not abort the batch.

import type {
  IConversationStateRepository,
  IUserRepository,
} from '../../../domain/ports/repositories';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { type TransitionConversationState } from './TransitionConversationState';

export class HandleExpiredSessions {
  constructor(
    private readonly conversationRepo: IConversationStateRepository,
    private readonly userRepo: IUserRepository,
    private readonly transitionState: TransitionConversationState,
    private readonly messagingPort: MessagingOutputPort,
  ) {}

  async execute(): Promise<void> {
    const expiredStates = await this.conversationRepo.findExpired();

    for (const state of expiredStates) {
      try {
        await this.transitionState.execute({
          userId: state.userId,
          targetState: 'IDLE',
          payload: null,
          expiresAt: null,
        });

        const identities = await this.userRepo.findMessagingIdentitiesByUserId(state.userId);

        for (const identity of identities) {
          try {
            await this.messagingPort.sendMessage(
              identity.externalId,
              'Tu sesion expiro. Queres continuar o empezar de nuevo?',
            );
          } catch (err) {
            console.error({
              msg: 'Failed to send session timeout message',
              userId: state.userId,
              channel: identity.channel,
              externalId: identity.externalId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        console.error({
          msg: 'Failed to process expired session',
          userId: state.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

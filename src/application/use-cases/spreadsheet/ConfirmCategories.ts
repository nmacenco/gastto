// LAYER: Application
// Use case: finalize the category vocabulary when the user confirms it.
// Marks vocabulary confirmed, transitions user to active, moves FSM to IDLE,
// and sends the final welcome message.

import type {
  ISpreadsheetConfigRepository,
  IUserRepository,
} from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import { onboardingCopies } from '../../copies/onboarding.copies';

export interface ConfirmCategoriesInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}

export interface ConfirmCategoriesOutput {
  nextState: FsmState;
  message: string;
}

export interface ConfirmCategoriesDeps {
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  userRepository: IUserRepository;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
}

export class ConfirmCategories {
  constructor(private readonly deps: ConfirmCategoriesDeps) {}

  async execute(input: ConfirmCategoriesInput): Promise<ConfirmCategoriesOutput> {
    const { userId, externalId } = input;

    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) {
      return this.handleReconnect(externalId, userId);
    }

    // Idempotent: if already confirmed, still return success
    if (config.categoriesConfirmedAt) {
      const message = onboardingCopies.onboardingComplete();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'IDLE', message };
    }

    await this.deps.spreadsheetConfigRepository.updateCategoriesConfirmed(config.id);
    await this.deps.userRepository.updateStatus(userId, 'active');

    const message = onboardingCopies.onboardingComplete();
    await this.deps.messagingPort.sendMessage(externalId, message);

    await this.deps.transitionState.execute({
      userId,
      targetState: 'IDLE',
    });

    return { nextState: 'IDLE', message };
  }

  private async handleReconnect(
    externalId: string,
    userId: string,
  ): Promise<ConfirmCategoriesOutput> {
    const message = onboardingCopies.reconnectAccount();
    await this.deps.messagingPort.sendMessage(externalId, message);

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });

    return { nextState: 'ONBOARDING_START', message };
  }
}

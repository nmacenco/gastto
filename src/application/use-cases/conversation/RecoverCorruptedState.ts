// LAYER: Application
// Use case: detect and recover from corrupted conversation states.
// Encapsulates the anomaly-logging + idle-reset rule so the Interfaces layer
// never calls the repository directly for recovery.

import { FSM_STATES, type FsmState } from '../../../domain/entities/ConversationState';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import type { IOperationLogRepository } from '../../../domain/ports/repositories';

export interface RecoverCorruptedStateInput {
  userId: string;
  observedState: string;
  observedRevision: string;
}

export interface RecoveryMessageDto {
  readonly message: string;
  readonly recovered: boolean;
}

export class RecoverCorruptedState {
  constructor(
    private readonly conversationRepo: IConversationStateRepository,
    private readonly logRepo: IOperationLogRepository,
  ) {}

  async execute(input: RecoverCorruptedStateInput): Promise<RecoveryMessageDto> {
    const isValid = FSM_STATES.includes(input.observedState as FsmState);

    if (!isValid) {
      const result = await this.conversationRepo.transition({
        userId: input.userId,
        expected: {
          revision: input.observedRevision,
          currentState: input.observedState,
          expiry: 'any',
        },
        nextState: 'IDLE',
        payload: null,
        expiresAt: null,
      });
      if (result.status !== 'updated') {
        return { message: '', recovered: false };
      }
      await this.logRepo.create(
        input.userId,
        'STATE_CORRUPTED',
        { observedState: input.observedState, observedRevision: input.observedRevision },
        'CORRUPTED_STATE',
      );

      return {
        message: 'Parece que algo falló. Vamos a empezar de nuevo.',
        recovered: true,
      };
    }

    return {
      message: '',
      recovered: false,
    };
  }
}

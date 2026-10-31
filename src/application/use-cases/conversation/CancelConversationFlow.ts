// LAYER: Application
// Cancels an observed onboarding flow before its step-specific parser runs.

import type { Logger } from 'pino';
import {
  getFinancialExecutionClaim,
  type ConversationState,
} from '../../../domain/entities/ConversationState';
import type {
  IMappingCorrectionStateRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { onboardingCopies } from '../../copies/onboarding.copies';
import type { CancelCloudConnection } from '../spreadsheet/CancelCloudConnection';
import type { TransitionConversationState } from './TransitionConversationState';

export interface CancelConversationFlowInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  state: ConversationState;
  source: 'text';
  messagingPort: MessagingOutputPort;
}

export type CancelConversationFlowOutcome =
  | { status: 'cancelled' }
  | { status: 'no_active_flow' }
  | { status: 'operation_in_progress' };

export interface CancelConversationFlowDeps {
  transitionState: TransitionConversationState;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  mappingCorrectionStateRepository: IMappingCorrectionStateRepository;
  cancelCloudConnection?: Pick<CancelCloudConnection, 'cleanup'> | null;
  logger: Logger;
}

export class CancelConversationFlow {
  constructor(private readonly deps: CancelConversationFlowDeps) {}

  async execute(input: CancelConversationFlowInput): Promise<CancelConversationFlowOutcome> {
    const { userId, externalId, state, messagingPort } = input;
    if (!state.currentState.startsWith('ONBOARDING_')) {
      return { status: 'no_active_flow' };
    }
    if (getFinancialExecutionClaim(state.statePayload) !== null) {
      return { status: 'operation_in_progress' };
    }

    await this.deps.transitionState.execute({
      userId,
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
      expected: this.deps.transitionState.precondition(state, 'any'),
    });

    const oauthState = state.currentState === 'ONBOARDING_DRIVE' ? state.statePayload?.state : null;
    if (typeof oauthState === 'string') {
      try {
        await this.deps.cancelCloudConnection?.cleanup(oauthState, userId);
      } catch (error) {
        this.deps.logger.error({
          msg: 'OAuth cleanup failed after onboarding cancellation',
          endpoint: 'CancelConversationFlow',
          code: 'OAUTH_CLEANUP_FAILED',
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const proposalId = state.statePayload?.proposalId;
    const spreadsheetId = state.statePayload?.spreadsheetId;
    if (state.currentState === 'ONBOARDING_MAPPING' && typeof proposalId === 'string') {
      try {
        const snapshot = await this.deps.mappingCorrectionStateRepository.load(userId);
        if (
          snapshot?.proposalId === proposalId &&
          (typeof spreadsheetId !== 'string' || snapshot.spreadsheetId === spreadsheetId)
        ) {
          await this.deps.mappingCorrectionStateRepository.clear(userId);
        }
      } catch (error) {
        this.deps.logger.error({
          msg: 'Mapping correction cleanup failed after onboarding cancellation',
          endpoint: 'CancelConversationFlow',
          code: 'MAPPING_CLEANUP_FAILED',
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    await messagingPort.sendMessage(
      externalId,
      onboardingCopies.flowCancelled(
        config?.categoriesConfirmedAt !== null && config?.categoriesConfirmedAt !== undefined,
      ),
    );
    return { status: 'cancelled' };
  }
}

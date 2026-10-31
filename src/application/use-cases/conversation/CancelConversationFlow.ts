// LAYER: Application
// Cancels an observed non-expense flow before its step-specific parser runs.

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
import { settingsCopies } from '../../copies/settings.copies';
import { expenseCopies } from '../../copies/expense.copies';
import type { CancelCloudConnection } from '../spreadsheet/CancelCloudConnection';
import { parseSettingsOAuthPayload } from '../spreadsheet/SettingsOAuthFlow';
import type { SettingsOAuthCleanup } from '../spreadsheet/SettingsOAuthCleanup';
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
  settingsOAuthCleanup?: Pick<SettingsOAuthCleanup, 'execute'> | null;
  logger: Logger;
}

export class CancelConversationFlow {
  constructor(private readonly deps: CancelConversationFlowDeps) {}

  async execute(input: CancelConversationFlowInput): Promise<CancelConversationFlowOutcome> {
    const { userId, externalId, state, messagingPort } = input;
    const isOnboarding = state.currentState.startsWith('ONBOARDING_');
    const isSettings = state.currentState.startsWith('SETTINGS_');
    const isFinancialExit =
      state.currentState === 'EXPENSE_SAVING_RETRY' ||
      state.currentState === 'EXPENSE_SAVING' ||
      state.currentState === 'EXPENSE_UNDO_CONFIRMING';
    if (!isOnboarding && !isSettings && !isFinancialExit) {
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

    if (state.currentState === 'SETTINGS_OAUTH') {
      const payload = parseSettingsOAuthPayload(state);
      if (payload) await this.deps.settingsOAuthCleanup?.execute(payload);
    }

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

    if (isOnboarding) {
      const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
      await messagingPort.sendMessage(
        externalId,
        onboardingCopies.flowCancelled(
          config?.categoriesConfirmedAt !== null && config?.categoriesConfirmedAt !== undefined,
        ),
      );
    } else if (isSettings) {
      await messagingPort.sendMessage(externalId, settingsCopies.cancelled());
    } else if (state.currentState === 'EXPENSE_UNDO_CONFIRMING') {
      await messagingPort.sendMessage(externalId, expenseCopies.undoCancelled());
    } else {
      await messagingPort.sendMessage(externalId, expenseCopies.saveRetryCancelled());
    }
    return { status: 'cancelled' };
  }
}

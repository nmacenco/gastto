// LAYER: Application
// Use case: finalize the column mapping when the user confirms the proposal.
// Loads the proposed mappings, marks them as confirmed, transitions to
// ONBOARDING_CATEGORIES, and sends the next-step message.

import type {
  IColumnMappingRepository,
  IMappingCorrectionStateRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { readActiveColumnMappingProposal } from '../../services/ActiveColumnMappingProposal';

export interface ConfirmColumnMappingInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}

export interface ConfirmColumnMappingOutput {
  nextState: FsmState;
  message: string;
  payload?: Record<string, unknown>;
}

export interface ConfirmColumnMappingDeps {
  columnMappingRepository: IColumnMappingRepository;
  correctionStateRepository: IMappingCorrectionStateRepository;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
}

export class ConfirmColumnMapping {
  constructor(private readonly deps: ConfirmColumnMappingDeps) {}

  async execute(input: ConfirmColumnMappingInput): Promise<ConfirmColumnMappingOutput> {
    const { userId, externalId } = input;

    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) {
      return this.handleReconnect(externalId, userId);
    }

    const proposal = readActiveColumnMappingProposal(input.statePayload, config);
    if (!proposal) {
      const message = onboardingCopies.mappingProposalRecoveryPrompt();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_MAPPING', message };
    }

    const confirmedAt = new Date();
    await this.deps.columnMappingRepository.replaceBySpreadsheetId(
      config.id,
      proposal.mappings.map((mapping) => ({
        GasttoField: mapping.GasttoField,
        columnIndex: mapping.columnIndex,
        columnHeader: mapping.columnHeader,
        inferred: mapping.inferred,
        confirmedAt,
      })),
    );
    await this.deps.correctionStateRepository.clear(userId);

    const payload: Record<string, unknown> = {
      provider: config.provider,
      fileId: config.fileId,
      sheetName: config.sheetName,
    };
    const headerRowIndex = input.statePayload?.headerRowIndex;
    if (
      typeof headerRowIndex === 'number' &&
      Number.isInteger(headerRowIndex) &&
      headerRowIndex > 0
    ) {
      payload.headerRowIndex = headerRowIndex;
    }

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_CATEGORIES',
      payload,
    });

    const message = onboardingCopies.mappingConfirmedNextStep();
    await this.deps.messagingPort.sendMessage(externalId, message);

    return { nextState: 'ONBOARDING_CATEGORIES', message, payload };
  }

  private async handleReconnect(
    externalId: string,
    userId: string,
  ): Promise<ConfirmColumnMappingOutput> {
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

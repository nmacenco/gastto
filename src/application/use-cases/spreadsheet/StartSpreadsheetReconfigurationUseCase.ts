// LAYER: Application
// Restarts validation and eager column inference for the active Google spreadsheet.

import type { ISpreadsheetConfigRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { ValidateSpreadsheetAccess } from './ValidateSpreadsheetAccess';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { expenseCopies } from '../../copies/expense.copies';

export interface StartSpreadsheetReconfigurationInput {
  userId: string;
  chatId: string;
  channel: 'telegram' | 'whatsapp';
}

export interface StartSpreadsheetReconfigurationDeps {
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  transitionState: TransitionConversationState;
  validateSpreadsheetAccess: ValidateSpreadsheetAccess;
  messagingPort: MessagingOutputPort;
}

export class StartSpreadsheetReconfigurationUseCase {
  constructor(private readonly deps: StartSpreadsheetReconfigurationDeps) {}

  async execute(input: StartSpreadsheetReconfigurationInput): Promise<void> {
    const config = await this.deps.spreadsheetConfigRepository.findByUserId(input.userId);
    if (!config || config.provider !== 'google') {
      await this.deps.transitionState.execute({
        userId: input.userId,
        targetState: 'IDLE',
        payload: null,
      });
      await this.deps.messagingPort.sendMessage(input.chatId, expenseCopies.saveRetryExpired());
      return;
    }

    const payload = {
      selectedFileId: config.fileId,
      selectedFileName: config.fileName,
      selectedSheetName: config.sheetName,
      provider: config.provider,
    };
    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'ONBOARDING_VALIDATING_ACCESS',
      payload,
    });
    await this.deps.validateSpreadsheetAccess.execute({
      userId: input.userId,
      externalId: input.chatId,
      channel: input.channel,
      statePayload: payload,
    });
  }
}

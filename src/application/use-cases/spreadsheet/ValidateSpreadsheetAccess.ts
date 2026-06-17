// LAYER: Application
// Use case: validate spreadsheet read/write access after sheet selection.
// Orchestrates the ONBOARDING_VALIDATING_ACCESS state.
// Receives the selected file/sheet identifiers, invokes the
// ValidateSpreadsheetAccessPort to read the preview and check write permissions,
// and applies business rules for the four HU-4.04 scenarios.

import type { ValidateSpreadsheetAccessPortFactory } from '../../../domain/ports/spreadsheetAccess';
import type {
  IOAuthTokenRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import type { TokenEncryptionPort } from '../../../domain/ports/tokenEncryption';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import type { SpreadsheetAccessResult } from '../../../domain/value-objects/SpreadsheetAccessResult';
import { onboardingCopies } from '../../copies/onboarding.copies';

export interface ValidateSpreadsheetAccessInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}

export interface ValidateSpreadsheetAccessOutput {
  nextState: FsmState;
  message: string;
  payload?: Record<string, unknown>;
}

export interface ValidateSpreadsheetAccessDeps {
  validateSpreadsheetAccessPortFactory: ValidateSpreadsheetAccessPortFactory;
  tokenRepository: IOAuthTokenRepository;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  tokenEncryption: TokenEncryptionPort;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
}

function isExpiredToken(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

export class ValidateSpreadsheetAccess {
  constructor(private readonly deps: ValidateSpreadsheetAccessDeps) {}

  async execute(input: ValidateSpreadsheetAccessInput): Promise<ValidateSpreadsheetAccessOutput> {
    const { userId, externalId, statePayload } = input;

    const provider = this.resolveProvider(statePayload);
    if (provider === 'microsoft') {
      const message = onboardingCopies.comingSoon('OneDrive');
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_VALIDATING_ACCESS', message };
    }

    const token = await this.deps.tokenRepository.findByUserAndProvider(userId, provider);
    if (!token) {
      return this.handleReconnect(externalId, userId);
    }

    if (token.revokedAt || isExpiredToken(token.accessTokenExpiresAt)) {
      return this.handleReconnect(externalId, userId);
    }

    let accessToken: string;
    try {
      accessToken = this.deps.tokenEncryption.decrypt(token.accessTokenEnc, token.iv);
    } catch {
      return this.handleReconnect(externalId, userId);
    }

    const fileId = statePayload?.selectedFileId as string;
    const sheetName = statePayload?.selectedSheetName as string;

    if (!fileId || typeof fileId !== 'string' || !sheetName || typeof sheetName !== 'string') {
      return this.handleReconnect(externalId, userId);
    }

    const port = this.deps.validateSpreadsheetAccessPortFactory.create(provider, accessToken);
    let result = await port.validateSpreadsheetAccess(fileId, sheetName);

    if (result.kind === 'access-error' && result.retryable) {
      result = await port.validateSpreadsheetAccess(fileId, sheetName);
    }

    return this.handleResult(result, input, provider, fileId, sheetName);
  }

  private async handleResult(
    result: SpreadsheetAccessResult,
    input: ValidateSpreadsheetAccessInput,
    provider: SpreadsheetProvider,
    fileId: string,
    sheetName: string,
  ): Promise<ValidateSpreadsheetAccessOutput> {
    const { userId, externalId, statePayload } = input;

    switch (result.kind) {
      case 'success': {
        const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
        if (config) {
          await this.deps.spreadsheetConfigRepository.updateAccessVerified(config.id);
        }

        const payload = {
          selectedFileId: fileId,
          selectedFileName: statePayload?.selectedFileName as string,
          selectedSheetName: sheetName,
          provider,
        };

        await this.deps.transitionState.execute({
          userId,
          targetState: 'ONBOARDING_MAPPING',
          payload,
        });

        return { nextState: 'ONBOARDING_MAPPING', message: '', payload };
      }

      case 'read-only': {
        const message = onboardingCopies.readOnlyWarning();
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_VALIDATING_ACCESS', message };
      }

      case 'empty-sheet': {
        const message = onboardingCopies.emptySheetConfirm(sheetName);
        await this.deps.messagingPort.sendMessage(externalId, message);

        const sheetList = statePayload?.sheetList as Record<string, unknown>[] | undefined;

        const payload: Record<string, unknown> = {
          selectedFileId: fileId,
          selectedFileName: statePayload?.selectedFileName as string,
          selectedSheetName: sheetName,
          provider,
          step: 'empty-sheet-confirm',
        };

        if (sheetList) {
          payload.sheetList = sheetList;
        }

        await this.deps.transitionState.execute({
          userId,
          targetState: 'ONBOARDING_SHEET',
          payload,
        });

        return { nextState: 'ONBOARDING_SHEET', message, payload };
      }

      case 'access-error': {
        return this.handleReconnect(externalId, userId);
      }
    }
  }

  private async handleReconnect(
    externalId: string,
    userId: string,
  ): Promise<ValidateSpreadsheetAccessOutput> {
    const message = onboardingCopies.reconnectAccount();
    await this.deps.messagingPort.sendMessage(externalId, message);

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_START',
    });

    return { nextState: 'ONBOARDING_START', message };
  }

  private resolveProvider(statePayload: Record<string, unknown> | null): SpreadsheetProvider {
    const p = statePayload?.provider;
    if (p === 'microsoft') return 'microsoft';
    return 'google';
  }
}

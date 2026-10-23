// LAYER: Application
// Use case: validate spreadsheet read/write access after sheet selection.
// Orchestrates the ONBOARDING_VALIDATING_ACCESS state.
// Receives the selected file/sheet identifiers, invokes the
// ValidateSpreadsheetAccessPort to read the preview and check write permissions,
// and applies business rules for the four HU-4.04 scenarios.

import type { ValidateSpreadsheetAccessPortFactory } from '../../../domain/ports/spreadsheetAccess';
import type { ISpreadsheetConfigRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import type { SpreadsheetAccessResult } from '../../../domain/value-objects/SpreadsheetAccessResult';
import type { InferColumnMapping } from './InferColumnMapping';
import { onboardingCopies } from '../../copies/onboarding.copies';
import type { Logger } from 'pino';
import type { OAuthAccessTokenProvider } from '../../services/OAuthAccessTokenService';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

const GOOGLE_SHEETS_WRITE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

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
  oauthAccessTokenService: OAuthAccessTokenProvider;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  inferColumnMapping: InferColumnMapping;
  logger: Logger;
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

    let accessToken: string;
    try {
      accessToken = (
        await this.deps.oauthAccessTokenService.getValidAccessToken({
          userId,
          provider,
          requiredScopes: provider === 'google' ? [GOOGLE_SHEETS_WRITE_SCOPE] : [],
        })
      ).accessToken;
    } catch (error) {
      if (error instanceof SpreadsheetError && error.code === 'AUTH_ERROR') {
        return this.handleReconnect(externalId, userId);
      }
      throw error;
    }

    const fileId = statePayload?.selectedFileId as string;
    const sheetName = statePayload?.selectedSheetName as string;

    if (!fileId || typeof fileId !== 'string' || !sheetName || typeof sheetName !== 'string') {
      return this.handleReconnect(externalId, userId);
    }

    let port = this.deps.validateSpreadsheetAccessPortFactory.create(provider, accessToken);
    let result = await port.validateSpreadsheetAccess(fileId, sheetName);

    if (result.kind === 'access-error' && this.isAuthorizationError(result)) {
      try {
        const refreshed = await this.deps.oauthAccessTokenService.forceRefreshAccessToken({
          userId,
          provider,
          requiredScopes: provider === 'google' ? [GOOGLE_SHEETS_WRITE_SCOPE] : [],
        });
        port = this.deps.validateSpreadsheetAccessPortFactory.create(
          provider,
          refreshed.accessToken,
        );
        result = await port.validateSpreadsheetAccess(fileId, sheetName);
      } catch (error) {
        if (error instanceof SpreadsheetError && error.code === 'AUTH_ERROR') {
          return this.handleReconnect(externalId, userId);
        }
        throw error;
      }
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
    const { userId, externalId, channel, statePayload } = input;

    switch (result.kind) {
      case 'success': {
        const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
        if (config) {
          await this.deps.spreadsheetConfigRepository.updateAccessVerified(config.id);
        }

        const preview = result.preview;
        const payload = {
          selectedFileId: fileId,
          selectedFileName: statePayload?.selectedFileName as string,
          selectedSheetName: sheetName,
          provider,
          preview: {
            provider: preview.provider,
            fileId: preview.fileId,
            sheetName: preview.sheetName,
            rows: preview.rows.map((row) => ({ index: row.index, values: [...row.values] })),
          },
        };

        await this.deps.transitionState.execute({
          userId,
          targetState: 'ONBOARDING_MAPPING',
          payload,
        });

        // Eager advance (ADR-014): infer the column mapping immediately after
        // successful access validation so the user does not need to send
        // another message to receive the mapping proposal.
        await this.triggerColumnInference(userId, externalId, channel, payload);

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
          selectedFileName: statePayload?.selectedFileName,
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
        if (this.isAuthorizationError(result)) {
          return this.handleReconnect(externalId, userId);
        }

        const message = onboardingCopies.sheetDiscoveryFailed();
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_VALIDATING_ACCESS', message };
      }
    }
  }

  private async triggerColumnInference(
    userId: string,
    externalId: string,
    channel: 'telegram' | 'whatsapp',
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.deps.inferColumnMapping.execute({
        userId,
        externalId,
        channel,
        statePayload: payload,
      });
    } catch (err) {
      this.deps.logger.error({
        endpoint: 'ValidateSpreadsheetAccess',
        code: 'POST_VALIDATING_ACCESS_MAPPING_FAILED',
        userId,
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
        error: err instanceof Error ? err.message : String(err),
      });
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
      payload: { promptShown: true },
    });

    return { nextState: 'ONBOARDING_START', message };
  }

  private resolveProvider(statePayload: Record<string, unknown> | null): SpreadsheetProvider {
    const p = statePayload?.provider;
    if (p === 'microsoft') return 'microsoft';
    return 'google';
  }

  private isAuthorizationError(
    result: Extract<SpreadsheetAccessResult, { kind: 'access-error' }>,
  ): boolean {
    return result.errorType === 'token-expired' || result.errorType === 'permission-denied';
  }
}

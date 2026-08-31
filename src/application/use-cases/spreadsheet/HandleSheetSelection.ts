// LAYER: Application
// Use case: orchestrate the ONBOARDING_SHEET state.
// Receives the user's raw message, the selected file metadata (from statePayload
// left by HU-4.02), and the decrypted OAuth token. Calls
// SpreadsheetPort.listSheets to discover available sheets, then branches
// according to the Gherkin scenarios: single-sheet auto-confirmation,
// numbered list selection, fuzzy name matching, header-based description for
// "I don't know", and re-prompt for invalid names. After confirmation, it
// persists the spreadsheet_configs record via
// ISpreadsheetConfigRepository.upsertByUserId (idempotent on re-onboarding),
// transitions the FSM to ONBOARDING_VALIDATING_ACCESS, sends the user the
// confirmation copy, and eagerly invokes ValidateSpreadsheetAccess.

import type { Logger } from 'pino';
import type { SpreadsheetPort, SpreadsheetPortFactory } from '../../../domain/ports/services';
import type { ISpreadsheetConfigRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import type { SheetInfo } from '../../../domain/entities/SheetInfo';
import type { ValidateSpreadsheetAccess } from './ValidateSpreadsheetAccess';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import { isConfirmIntent, isIdkVariant } from '../../utils/intents';
import {
  executeWithOAuthAccessToken,
  type OAuthAccessTokenProvider,
} from '../../services/OAuthAccessTokenService';

export interface HandleSheetSelectionInput {
  userId: string;
  rawMessage: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}

export interface HandleSheetSelectionOutput {
  nextState: FsmState;
  message: string;
  payload?: Record<string, unknown>;
}

export interface HandleSheetSelectionDeps {
  spreadsheetPortFactory: SpreadsheetPortFactory;
  oauthAccessTokenService: OAuthAccessTokenProvider;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  validateSpreadsheetAccess: ValidateSpreadsheetAccess;
  logger: Logger;
}

// ── Normalization helpers ────────────────────────────────────────────────────

function normalizeForComparison(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// ── Use case ─────────────────────────────────────────────────────────────────

export class HandleSheetSelection {
  constructor(private readonly deps: HandleSheetSelectionDeps) {}

  async execute(input: HandleSheetSelectionInput): Promise<HandleSheetSelectionOutput> {
    const { userId, rawMessage, externalId, statePayload, channel } = input;

    const provider = this.resolveProvider(statePayload);
    if (provider === 'microsoft') {
      const message = onboardingCopies.comingSoon('OneDrive');
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_SHEET', message };
    }

    if (statePayload?.step === 'empty-sheet-confirm') {
      return this.handleEmptySheetConfirm(
        userId,
        externalId,
        channel,
        rawMessage,
        provider,
        statePayload,
      );
    }

    try {
      await this.deps.oauthAccessTokenService.getValidAccessToken({ userId, provider });
    } catch (err) {
      if (err instanceof SpreadsheetError && err.code === 'AUTH_ERROR') {
        return this.handleReconnect(externalId, userId, 'TOKEN_UNAVAILABLE', err);
      }
      throw err;
    }

    const fileId = statePayload?.selectedFileId as string;
    const fileName = statePayload?.selectedFileName as string;

    if (!fileId || typeof fileId !== 'string') {
      this.deps.logger.error({
        endpoint: 'HandleSheetSelection',
        code: 'MISSING_FILE_ID',
        userId,
      });
      const message = onboardingCopies.fileAccessFailed();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_SHEET', message };
    }

    // 3. Check if we already have a sheet list (user is selecting)
    const sheetList = statePayload?.sheetList as SheetInfo[] | undefined;
    if (Array.isArray(sheetList) && sheetList.length > 0) {
      return this.handleSelection(
        userId,
        externalId,
        channel,
        fileId,
        fileName,
        provider,
        rawMessage,
        sheetList,
      );
    }

    // 4. First time: list sheets
    return this.handleInitialListing(userId, externalId, channel, fileId, fileName, provider);
  }

  private resolveProvider(statePayload: Record<string, unknown> | null): SpreadsheetProvider {
    const p = statePayload?.provider;
    if (p === 'microsoft') return 'microsoft';
    return 'google';
  }

  private async handleEmptySheetConfirm(
    userId: string,
    externalId: string,
    channel: 'telegram' | 'whatsapp',
    rawMessage: string,
    provider: SpreadsheetProvider,
    statePayload: Record<string, unknown>,
  ): Promise<HandleSheetSelectionOutput> {
    const trimmed = rawMessage.trim();

    if (isConfirmIntent(trimmed)) {
      const message = onboardingCopies.emptySheetConfirmedOutOfMvp();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_SHEET', message };
    }

    const sheetList = statePayload?.sheetList as SheetInfo[] | undefined;
    const fileId = statePayload?.selectedFileId as string;
    const fileName = statePayload?.selectedFileName as string;

    if (!Array.isArray(sheetList) || sheetList.length === 0 || !fileId) {
      this.deps.logger.error({
        endpoint: 'HandleSheetSelection',
        code: 'EMPTY_SHEET_CONFIRM_MISSING_STATE',
        userId,
      });
      const message = onboardingCopies.fileAccessFailed();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_SHEET', message };
    }

    try {
      await this.deps.oauthAccessTokenService.getValidAccessToken({ userId, provider });
    } catch (err) {
      if (err instanceof SpreadsheetError && err.code === 'AUTH_ERROR') {
        return this.handleReconnect(externalId, userId, 'TOKEN_UNAVAILABLE', err);
      }
      throw err;
    }

    return this.handleSelection(
      userId,
      externalId,
      channel,
      fileId,
      fileName,
      provider,
      trimmed,
      sheetList,
    );
  }

  private async handleInitialListing(
    userId: string,
    externalId: string,
    channel: 'telegram' | 'whatsapp',
    fileId: string,
    fileName: string,
    provider: SpreadsheetProvider,
  ): Promise<HandleSheetSelectionOutput> {
    try {
      const sheets = await this.executeWithSpreadsheetPort(userId, provider, (port) =>
        port.listSheets(fileId),
      );

      if (sheets.length === 0) {
        const message = 'El archivo no tiene hojas. Probá con otro archivo.';
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_SHEET', message };
      }

      if (sheets.length === 1) {
        // Scenario 1: Single-sheet auto-confirmation
        return this.confirmSheet(
          userId,
          externalId,
          channel,
          fileId,
          fileName,
          provider,
          sheets[0]!,
        );
      }

      // Scenario 2: Multiple sheets — prompt user to choose
      const message = onboardingCopies.sheetListPrompt(sheets);
      await this.deps.messagingPort.sendMessage(externalId, message);

      const payload = {
        selectedFileId: fileId,
        selectedFileName: fileName,
        provider,
        sheetList: sheets as unknown as Record<string, unknown>[],
      };
      await this.deps.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_SHEET',
        payload,
      });

      return { nextState: 'ONBOARDING_SHEET', message, payload };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (err instanceof SpreadsheetError && err.code === 'AUTH_ERROR') {
        return this.handleReconnect(externalId, userId, 'SHEET_LIST_AUTH_ERROR', err);
      }
      if (err instanceof SpreadsheetError) {
        this.deps.logger.error({
          endpoint: 'HandleSheetSelection',
          code: 'SHEET_LIST_ERROR',
          userId,
          fileId,
          error: errorMessage,
        });
        const message = `Hubo un problema al listar las hojas: ${errorMessage}. Intentá de nuevo en unos segundos.`;
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_SHEET', message };
      }

      this.deps.logger.error({
        endpoint: 'HandleSheetSelection',
        code: 'SHEET_LIST_UNEXPECTED_ERROR',
        userId,
        fileId,
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
        error: errorMessage,
      });
      const message = onboardingCopies.sheetDiscoveryFailed();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_SHEET', message };
    }
  }

  private async handleSelection(
    userId: string,
    externalId: string,
    channel: 'telegram' | 'whatsapp',
    fileId: string,
    fileName: string,
    provider: SpreadsheetProvider,
    rawMessage: string,
    sheetList: SheetInfo[],
  ): Promise<HandleSheetSelectionOutput> {
    const trimmed = rawMessage.trim();

    // Scenario 3: "I don't know" variant
    if (isIdkVariant(trimmed)) {
      return this.handleIdk(userId, externalId, channel, fileId, provider, sheetList);
    }

    // Scenario 2: Selection by number
    const choice = parseInt(trimmed, 10);
    if (!Number.isNaN(choice) && choice >= 1 && choice <= sheetList.length) {
      return this.confirmSheet(
        userId,
        externalId,
        channel,
        fileId,
        fileName,
        provider,
        sheetList[choice - 1]!,
        sheetList,
      );
    }

    // Scenario 4: Fuzzy name matching
    const normalizedInput = normalizeForComparison(trimmed);
    const matched = sheetList.find((s) => normalizeForComparison(s.name) === normalizedInput);
    if (matched) {
      return this.confirmSheet(
        userId,
        externalId,
        channel,
        fileId,
        fileName,
        provider,
        matched,
        sheetList,
      );
    }

    // Scenario 5: Invalid name — re-prompt
    const message = onboardingCopies.sheetNotFoundRePrompt(sheetList);
    await this.deps.messagingPort.sendMessage(externalId, message);
    return { nextState: 'ONBOARDING_SHEET', message };
  }

  private async handleIdk(
    userId: string,
    externalId: string,
    channel: 'telegram' | 'whatsapp',
    fileId: string,
    provider: SpreadsheetProvider,
    sheetList: SheetInfo[],
  ): Promise<HandleSheetSelectionOutput> {
    try {
      const descriptions: string[] = [];
      for (const sheet of sheetList) {
        const headers = await this.executeWithSpreadsheetPort(userId, provider, (port) =>
          port.getHeaders(fileId, sheet.name),
        );
        descriptions.push(onboardingCopies.sheetHeadersDescription(sheet.name, headers));
      }

      const message = `${onboardingCopies.sheetIdkPrompt()}\n\n${descriptions.join('\n')}\n\n¿Cuál querés usar? Escribí el número o el nombre.`;
      await this.deps.messagingPort.sendMessage(externalId, message);

      const payload = {
        selectedFileId: fileId,
        sheetList: sheetList as unknown as Record<string, unknown>[],
        step: 'idk',
      };
      await this.deps.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_SHEET',
        payload,
      });

      return { nextState: 'ONBOARDING_SHEET', message, payload };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (err instanceof SpreadsheetError && err.code === 'AUTH_ERROR') {
        return this.handleReconnect(externalId, userId, 'SHEET_HEADERS_AUTH_ERROR', err);
      }
      if (err instanceof SpreadsheetError) {
        this.deps.logger.error({
          endpoint: 'HandleSheetSelection',
          code: 'SHEET_HEADERS_ERROR',
          userId,
          fileId,
          error: errorMessage,
        });
        const message = `Hubo un problema al leer las hojas: ${errorMessage}. Intentá de nuevo.`;
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_SHEET', message };
      }

      this.deps.logger.error({
        endpoint: 'HandleSheetSelection',
        code: 'SHEET_HEADERS_UNEXPECTED_ERROR',
        userId,
        fileId,
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
        error: errorMessage,
      });
      const message = onboardingCopies.sheetDiscoveryFailed();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_SHEET', message };
    }
  }

  private executeWithSpreadsheetPort<T>(
    userId: string,
    provider: SpreadsheetProvider,
    operation: (port: SpreadsheetPort) => Promise<T>,
  ): Promise<T> {
    return executeWithOAuthAccessToken(
      this.deps.oauthAccessTokenService,
      { userId, provider },
      (accessToken) => operation(this.deps.spreadsheetPortFactory.create(accessToken)),
    );
  }

  private async confirmSheet(
    userId: string,
    externalId: string,
    channel: 'telegram' | 'whatsapp',
    fileId: string,
    fileName: string,
    provider: SpreadsheetProvider,
    sheet: SheetInfo,
    sheetList?: SheetInfo[],
  ): Promise<HandleSheetSelectionOutput> {
    // Persist spreadsheet config (idempotent on re-onboarding via upsert on
    // the per-user unique constraint uq_user_spreadsheet).
    await this.deps.spreadsheetConfigRepository.upsertByUserId({
      userId,
      provider,
      fileId,
      fileName,
      sheetName: sheet.name,
      accessVerifiedAt: new Date(),
      categoriesConfirmedAt: null,
    });

    const payload: Record<string, unknown> = {
      selectedFileId: fileId,
      selectedFileName: fileName,
      selectedSheetName: sheet.name,
      provider,
    };

    if (sheetList) {
      payload.sheetList = sheetList;
    }

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_VALIDATING_ACCESS',
      payload,
    });

    const message = onboardingCopies.sheetSelectedConfirmation(sheet.name);
    await this.deps.messagingPort.sendMessage(externalId, message);

    // Eager advance (ADR-014): validate read/write access immediately after
    // sheet selection so the user does not need to send another message.
    await this.triggerAccessValidation(userId, externalId, channel, payload);

    return { nextState: 'ONBOARDING_VALIDATING_ACCESS', message, payload };
  }

  private async triggerAccessValidation(
    userId: string,
    externalId: string,
    channel: 'telegram' | 'whatsapp',
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.deps.validateSpreadsheetAccess.execute({
        userId,
        externalId,
        channel,
        statePayload: payload,
      });
    } catch (err) {
      this.deps.logger.error({
        endpoint: 'HandleSheetSelection',
        code: 'POST_SHEET_VALIDATING_ACCESS_FAILED',
        userId,
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleReconnect(
    externalId: string,
    userId: string,
    code: string,
    err?: unknown,
  ): Promise<HandleSheetSelectionOutput> {
    this.deps.logger.error({
      endpoint: 'HandleSheetSelection',
      code,
      userId,
      errorType: err instanceof Error ? err.constructor.name : undefined,
      error: err instanceof Error ? err.message : undefined,
    });

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

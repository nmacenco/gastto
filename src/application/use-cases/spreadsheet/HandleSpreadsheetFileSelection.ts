// LAYER: Application
// Use case: orchestrate the ONBOARDING_FILE state.
// Retrieves the user's OAuth token, calls CloudStoragePort to list/search/validate
// spreadsheet files, handles the user's reply, and transitions FSM accordingly.

import type { Logger } from 'pino';
import type { CloudStoragePort } from '../../../domain/ports/cloudStorage';
import type { IOAuthTokenRepository } from '../../../domain/ports/repositories';
import type { TokenEncryptionPort } from '../../../domain/ports/tokenEncryption';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import type { CloudFile } from '../../../domain/entities/CloudFile';
import type { HandleSheetSelection } from './HandleSheetSelection';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { FileDiscoveryError } from '../../../domain/errors/FileDiscoveryError';

export interface HandleSpreadsheetFileSelectionInput {
  userId: string;
  rawMessage: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}

export interface HandleSpreadsheetFileSelectionOutput {
  nextState: FsmState;
  message: string;
  payload?: Record<string, unknown>;
}

export interface HandleSpreadsheetFileSelectionDeps {
  cloudStorage: CloudStoragePort;
  tokenRepository: IOAuthTokenRepository;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  tokenEncryption: TokenEncryptionPort;
  logger: Logger;
  handleSheetSelection: HandleSheetSelection;
}

const NONE_OF_THESE_VARIANTS = [
  'ninguno',
  'ninguno de estos',
  'ninguna',
  'ninguna de estas',
  'no',
  'no es ninguno',
  'no es ninguna',
  'nope',
];

function isNoneOfThese(raw: string): boolean {
  const normalized = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  return NONE_OF_THESE_VARIANTS.includes(normalized);
}

function extractGoogleDriveFileId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'drive.google.com') {
      const match = parsed.pathname.match(/\/file\/d\/([^/]+)/);
      if (match && match[1]) return match[1];
      const id = parsed.searchParams.get('id');
      if (id) return id;
    }
  } catch {
    // not a valid URL
  }
  return null;
}

function isExpiredToken(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

export class HandleSpreadsheetFileSelection {
  constructor(private readonly deps: HandleSpreadsheetFileSelectionDeps) {}

  async execute(
    input: HandleSpreadsheetFileSelectionInput,
  ): Promise<HandleSpreadsheetFileSelectionOutput> {
    const { userId, rawMessage, externalId, channel, statePayload } = input;

    const provider = this.resolveProvider(statePayload);
    if (provider === 'microsoft') {
      const message = onboardingCopies.comingSoon('OneDrive');
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }

    // 1. Retrieve and decrypt OAuth token
    const token = await this.deps.tokenRepository.findByUserAndProvider(userId, provider);
    if (!token) {
      return this.handleReconnect(externalId, userId, 'TOKEN_MISSING');
    }

    if (token.revokedAt || isExpiredToken(token.accessTokenExpiresAt)) {
      return this.handleReconnect(externalId, userId, 'TOKEN_EXPIRED_OR_REVOKED');
    }

    let accessToken: string;
    try {
      accessToken = this.deps.tokenEncryption.decrypt(token.accessTokenEnc, token.iv);
    } catch (err) {
      return this.handleReconnect(externalId, userId, 'TOKEN_DECRYPTION_FAILED', err);
    }

    // 2. Handle search step
    const step = statePayload?.step;
    if (step === 'searching') {
      return this.handleSearch(userId, externalId, accessToken, provider, rawMessage);
    }

    // 3. If no fileList yet, show initial listing
    const fileList = statePayload?.fileList;
    if (!Array.isArray(fileList) || fileList.length === 0) {
      return this.handleInitialListing(userId, externalId, accessToken, provider);
    }

    // 4. Parse user reply against the displayed list
    const files = fileList as CloudFile[];
    const choice = parseInt(rawMessage.trim(), 10);

    if (!Number.isNaN(choice) && choice >= 1 && choice <= files.length) {
      return this.handleNumberSelection(
        userId,
        externalId,
        channel,
        accessToken,
        provider,
        files,
        choice,
      );
    }

    if (choice === files.length + 1 || isNoneOfThese(rawMessage)) {
      return this.handleNoneOfThese(userId, externalId);
    }

    // 5. Check for direct URL
    const fileIdFromUrl = extractGoogleDriveFileId(rawMessage.trim());
    if (fileIdFromUrl) {
      return this.handleDirectUrl(
        userId,
        externalId,
        channel,
        accessToken,
        provider,
        fileIdFromUrl,
        rawMessage.trim(),
      );
    }

    // 6. Unrecognized input
    const message = onboardingCopies.invalidSelectionRePrompt(files.length);
    await this.deps.messagingPort.sendMessage(externalId, message);
    return { nextState: 'ONBOARDING_FILE', message };
  }

  private resolveProvider(statePayload: Record<string, unknown> | null): SpreadsheetProvider {
    const p = statePayload?.provider;
    if (p === 'microsoft') return 'microsoft';
    return 'google';
  }

  private async handleInitialListing(
    userId: string,
    externalId: string,
    accessToken: string,
    provider: SpreadsheetProvider,
  ): Promise<HandleSpreadsheetFileSelectionOutput> {
    try {
      const files = await this.deps.cloudStorage.listRecentSpreadsheets(accessToken, provider);

      if (files.length === 0) {
        const message = onboardingCopies.noFilesFoundPrompt();
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_FILE', message };
      }

      const message = onboardingCopies.fileListPrompt(files);
      await this.deps.messagingPort.sendMessage(externalId, message);

      const payload = { fileList: files as unknown as Record<string, unknown>[] };
      await this.deps.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_FILE',
        payload,
      });

      return { nextState: 'ONBOARDING_FILE', message, payload };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (err instanceof FileDiscoveryError) {
        this.deps.logger.error({
          endpoint: 'HandleSpreadsheetFileSelection',
          code: 'FILE_DISCOVERY_ERROR',
          userId,
          error: errorMessage,
        });
        const message = `Hubo un problema al buscar archivos: ${errorMessage}. Intentá de nuevo en unos segundos.`;
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_FILE', message };
      }

      this.deps.logger.error({
        endpoint: 'HandleSpreadsheetFileSelection',
        code: 'FILE_DISCOVERY_UNEXPECTED_ERROR',
        userId,
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
        error: errorMessage,
      });
      const message = onboardingCopies.fileDiscoveryFailed();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }
  }

  private async handleNumberSelection(
    userId: string,
    externalId: string,
    channel: 'telegram' | 'whatsapp',
    accessToken: string,
    provider: SpreadsheetProvider,
    files: CloudFile[],
    choice: number,
  ): Promise<HandleSpreadsheetFileSelectionOutput> {
    const selected = files[choice - 1];
    if (!selected) {
      const message = onboardingCopies.invalidSelectionRePrompt(files.length);
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }

    try {
      const hasAccess = await this.deps.cloudStorage.validateFileAccess(
        selected.id,
        accessToken,
        provider,
      );

      if (!hasAccess) {
        const message = onboardingCopies.urlValidationFailed();
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_FILE', message };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (err instanceof FileDiscoveryError) {
        this.deps.logger.error({
          endpoint: 'HandleSpreadsheetFileSelection',
          code: 'FILE_ACCESS_ERROR',
          userId,
          fileId: selected.id,
          error: errorMessage,
        });
        const message = `Hubo un problema al validar el acceso: ${errorMessage}. Intentá de nuevo.`;
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_FILE', message };
      }

      this.deps.logger.error({
        endpoint: 'HandleSpreadsheetFileSelection',
        code: 'FILE_ACCESS_UNEXPECTED_ERROR',
        userId,
        fileId: selected.id,
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
        error: errorMessage,
      });
      const message = onboardingCopies.fileAccessFailed();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }

    const message = onboardingCopies.fileSelectedConfirmation(selected.name);
    await this.deps.messagingPort.sendMessage(externalId, message);

    const payload = {
      selectedFileId: selected.id,
      selectedFileName: selected.name,
      provider,
    };

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_SHEET',
      payload,
    });

    await this.triggerSheetSelection(
      userId,
      externalId,
      channel,
      selected.id,
      selected.name,
      provider,
    );

    return { nextState: 'ONBOARDING_SHEET', message, payload };
  }

  private async handleNoneOfThese(
    userId: string,
    externalId: string,
  ): Promise<HandleSpreadsheetFileSelectionOutput> {
    const message = onboardingCopies.searchByNamePrompt();
    await this.deps.messagingPort.sendMessage(externalId, message);

    const payload = { step: 'searching' };
    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_FILE',
      payload,
    });

    return { nextState: 'ONBOARDING_FILE', message, payload };
  }

  private async handleSearch(
    userId: string,
    externalId: string,
    accessToken: string,
    provider: SpreadsheetProvider,
    query: string,
  ): Promise<HandleSpreadsheetFileSelectionOutput> {
    try {
      const files = await this.deps.cloudStorage.searchSpreadsheets(accessToken, provider, query);

      if (files.length === 0) {
        const message = onboardingCopies.noFilesFoundPrompt();
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_FILE', message };
      }

      const message = onboardingCopies.fileListPrompt(files);
      await this.deps.messagingPort.sendMessage(externalId, message);

      const payload = { fileList: files as unknown as Record<string, unknown>[] };
      await this.deps.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_FILE',
        payload,
      });

      return { nextState: 'ONBOARDING_FILE', message, payload };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (err instanceof FileDiscoveryError) {
        this.deps.logger.error({
          endpoint: 'HandleSpreadsheetFileSelection',
          code: 'FILE_SEARCH_ERROR',
          userId,
          query,
          error: errorMessage,
        });
        const message = `Hubo un problema al buscar archivos: ${errorMessage}. Intentá de nuevo en unos segundos.`;
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_FILE', message };
      }

      this.deps.logger.error({
        endpoint: 'HandleSpreadsheetFileSelection',
        code: 'FILE_SEARCH_UNEXPECTED_ERROR',
        userId,
        query,
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
        error: errorMessage,
      });
      const message = onboardingCopies.fileDiscoveryFailed();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }
  }

  private async handleDirectUrl(
    userId: string,
    externalId: string,
    channel: 'telegram' | 'whatsapp',
    accessToken: string,
    provider: SpreadsheetProvider,
    fileId: string,
    rawUrl: string,
  ): Promise<HandleSpreadsheetFileSelectionOutput> {
    try {
      const hasAccess = await this.deps.cloudStorage.validateFileAccess(
        fileId,
        accessToken,
        provider,
      );

      if (!hasAccess) {
        const message = onboardingCopies.urlValidationFailed();
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_FILE', message };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (err instanceof FileDiscoveryError) {
        this.deps.logger.error({
          endpoint: 'HandleSpreadsheetFileSelection',
          code: 'URL_ACCESS_ERROR',
          userId,
          fileId,
          error: errorMessage,
        });
        const message = `Hubo un problema al validar el acceso: ${errorMessage}. Intentá de nuevo.`;
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_FILE', message };
      }

      this.deps.logger.error({
        endpoint: 'HandleSpreadsheetFileSelection',
        code: 'URL_ACCESS_UNEXPECTED_ERROR',
        userId,
        fileId,
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
        error: errorMessage,
      });
      const message = onboardingCopies.fileAccessFailed();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }

    // We don't have the file name from a URL alone; use the URL as a fallback name
    const fileName = rawUrl;
    const message = onboardingCopies.urlValidationSuccess(fileName);
    await this.deps.messagingPort.sendMessage(externalId, message);

    const payload = {
      selectedFileId: fileId,
      selectedFileName: fileName,
      provider,
    };

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_SHEET',
      payload,
    });

    await this.triggerSheetSelection(userId, externalId, channel, fileId, fileName, provider);

    return { nextState: 'ONBOARDING_SHEET', message, payload };
  }

  private async triggerSheetSelection(
    userId: string,
    externalId: string,
    channel: 'telegram' | 'whatsapp',
    fileId: string,
    fileName: string,
    provider: SpreadsheetProvider,
  ): Promise<void> {
    try {
      await this.deps.handleSheetSelection.execute({
        userId,
        rawMessage: '',
        externalId,
        channel,
        statePayload: { selectedFileId: fileId, selectedFileName: fileName, provider },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.deps.logger.error({
        endpoint: 'HandleSpreadsheetFileSelection',
        code: 'POST_SELECTION_SHEET_DISCOVERY_FAILED',
        userId,
        fileId,
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
        error: errorMessage,
      });
    }
  }

  private async handleReconnect(
    externalId: string,
    userId: string,
    code: string,
    err?: unknown,
  ): Promise<HandleSpreadsheetFileSelectionOutput> {
    this.deps.logger.error({
      endpoint: 'HandleSpreadsheetFileSelection',
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

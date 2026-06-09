// LAYER: Application
// Use case: orchestrate the ONBOARDING_FILE state.
// Retrieves the user's OAuth token, calls CloudStoragePort to list/search/validate
// spreadsheet files, handles the user's reply, and transitions FSM accordingly.

import type { CloudStoragePort } from '../../../domain/ports/cloudStorage';
import type { IOAuthTokenRepository } from '../../../domain/ports/repositories';
import type { TokenEncryptionPort } from '../../../domain/ports/tokenEncryption';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import type { CloudFile } from '../../../domain/entities/CloudFile';
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
    const { userId, rawMessage, externalId, statePayload } = input;

    const provider = this.resolveProvider(statePayload);
    if (provider === 'microsoft') {
      const message = onboardingCopies.comingSoon('OneDrive');
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }

    // 1. Retrieve and decrypt OAuth token
    const token = await this.deps.tokenRepository.findByUserAndProvider(userId, provider);
    if (!token) {
      const message = onboardingCopies.connectionFailed(true);
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }

    if (token.revokedAt || isExpiredToken(token.accessTokenExpiresAt)) {
      const message = onboardingCopies.connectionFailed(true);
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }

    let accessToken: string;
    try {
      accessToken = this.deps.tokenEncryption.decrypt(token.accessTokenEnc, token.iv);
    } catch {
      const message = onboardingCopies.connectionFailed(true);
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
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
      return this.handleNumberSelection(userId, externalId, accessToken, provider, files, choice);
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
      const message =
        err instanceof FileDiscoveryError
          ? `Hubo un problema al buscar archivos: ${err.message}. Intentá de nuevo en unos segundos.`
          : onboardingCopies.connectionFailed(true);
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }
  }

  private async handleNumberSelection(
    userId: string,
    externalId: string,
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
      const message =
        err instanceof FileDiscoveryError
          ? `Hubo un problema al validar el acceso: ${err.message}. Intentá de nuevo.`
          : onboardingCopies.connectionFailed(true);
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }

    const message = onboardingCopies.fileSelectedConfirmation(selected.name);
    await this.deps.messagingPort.sendMessage(externalId, message);

    const payload = {
      selectedFileId: selected.id,
      selectedFileName: selected.name,
    };

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_SHEET',
      payload,
    });

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
      const message =
        err instanceof FileDiscoveryError
          ? `Hubo un problema al buscar archivos: ${err.message}. Intentá de nuevo en unos segundos.`
          : onboardingCopies.connectionFailed(true);
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_FILE', message };
    }
  }

  private async handleDirectUrl(
    userId: string,
    externalId: string,
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
      const message =
        err instanceof FileDiscoveryError
          ? `Hubo un problema al validar el acceso: ${err.message}. Intentá de nuevo.`
          : onboardingCopies.connectionFailed(true);
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
    };

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_SHEET',
      payload,
    });

    return { nextState: 'ONBOARDING_SHEET', message, payload };
  }
}

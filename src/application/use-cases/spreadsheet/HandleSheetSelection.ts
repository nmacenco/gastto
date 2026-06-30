// LAYER: Application
// Use case: orchestrate the ONBOARDING_SHEET state.
// Receives the user's raw message, the selected file metadata (from statePayload
// left by HU-4.02), and the decrypted OAuth token. Calls
// SpreadsheetPort.listSheets to discover available sheets, then branches
// according to the Gherkin scenarios: single-sheet auto-confirmation,
// numbered list selection, fuzzy name matching, header-based description for
// "I don't know", and re-prompt for invalid names. After confirmation, it
// calls ISpreadsheetConfigRepository.create to persist the
// spreadsheet_configs record with sheetName and a placeholder
// accessVerifiedAt, then transitions the FSM to ONBOARDING_VALIDATING_ACCESS.

import type { Logger } from 'pino';
import type { SpreadsheetPort, SpreadsheetPortFactory } from '../../../domain/ports/services';
import type {
  IOAuthTokenRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import type { TokenEncryptionPort } from '../../../domain/ports/tokenEncryption';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import type { SheetInfo } from '../../../domain/entities/SheetInfo';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import { isConfirmIntent } from '../../utils/intents';

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
  tokenRepository: IOAuthTokenRepository;
  transitionState: TransitionConversationState;
  messagingPort: MessagingOutputPort;
  tokenEncryption: TokenEncryptionPort;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  logger: Logger;
}

// ── Normalization helpers ────────────────────────────────────────────────────

const IDK_VARIANTS = [
  'no sé',
  'no se',
  'no lo se',
  'no sé cuál',
  'no se cual',
  'no lo sé',
  'no sé cual',
  'ni idea',
  'no tengo idea',
  'no se cual es',
  'no sé cual es',
  'no se cual usar',
  'no sé cual usar',
  'no se',
  'nose',
  'no sepa',
  'no c',
  'noce',
  'no se cual',
  'no sé cual',
];

function isIdkVariant(raw: string): boolean {
  const normalized = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  return IDK_VARIANTS.includes(normalized);
}

function normalizeForComparison(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function isExpiredToken(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

// ── Use case ─────────────────────────────────────────────────────────────────

export class HandleSheetSelection {
  constructor(private readonly deps: HandleSheetSelectionDeps) {}

  async execute(input: HandleSheetSelectionInput): Promise<HandleSheetSelectionOutput> {
    const { userId, rawMessage, externalId, statePayload } = input;

    const provider = this.resolveProvider(statePayload);
    if (provider === 'microsoft') {
      const message = onboardingCopies.comingSoon('OneDrive');
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_SHEET', message };
    }

    if (statePayload?.step === 'empty-sheet-confirm') {
      return this.handleEmptySheetConfirm(userId, externalId, rawMessage, provider, statePayload);
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

    // 2. Create SpreadsheetPort
    const spreadsheetPort = this.deps.spreadsheetPortFactory.create(provider, accessToken);

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
        fileId,
        fileName,
        provider,
        rawMessage,
        sheetList,
        spreadsheetPort,
      );
    }

    // 4. First time: list sheets
    return this.handleInitialListing(
      userId,
      externalId,
      fileId,
      fileName,
      provider,
      spreadsheetPort,
    );
  }

  private resolveProvider(statePayload: Record<string, unknown> | null): SpreadsheetProvider {
    const p = statePayload?.provider;
    if (p === 'microsoft') return 'microsoft';
    return 'google';
  }

  private async handleEmptySheetConfirm(
    userId: string,
    externalId: string,
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

    const token = await this.deps.tokenRepository.findByUserAndProvider(userId, provider);
    if (!token || token.revokedAt || isExpiredToken(token.accessTokenExpiresAt)) {
      return this.handleReconnect(externalId, userId, 'TOKEN_INVALID_ON_EMPTY_SHEET_CONFIRM');
    }

    let accessToken: string;
    try {
      accessToken = this.deps.tokenEncryption.decrypt(token.accessTokenEnc, token.iv);
    } catch (err) {
      return this.handleReconnect(externalId, userId, 'TOKEN_DECRYPTION_FAILED', err);
    }

    const spreadsheetPort = this.deps.spreadsheetPortFactory.create(provider, accessToken);

    return this.handleSelection(
      userId,
      externalId,
      fileId,
      fileName,
      provider,
      trimmed,
      sheetList,
      spreadsheetPort,
    );
  }

  private async handleInitialListing(
    userId: string,
    externalId: string,
    fileId: string,
    fileName: string,
    provider: SpreadsheetProvider,
    spreadsheetPort: SpreadsheetPort,
  ): Promise<HandleSheetSelectionOutput> {
    try {
      const sheets = await spreadsheetPort.listSheets(fileId);

      if (sheets.length === 0) {
        const message = 'El archivo no tiene hojas. Probá con otro archivo.';
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_SHEET', message };
      }

      if (sheets.length === 1) {
        // Scenario 1: Single-sheet auto-confirmation
        return this.confirmSheet(userId, externalId, fileId, fileName, provider, sheets[0]!);
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
    fileId: string,
    fileName: string,
    provider: SpreadsheetProvider,
    rawMessage: string,
    sheetList: SheetInfo[],
    spreadsheetPort: SpreadsheetPort,
  ): Promise<HandleSheetSelectionOutput> {
    const trimmed = rawMessage.trim();

    // Scenario 3: "I don't know" variant
    if (isIdkVariant(trimmed)) {
      return this.handleIdk(userId, externalId, fileId, sheetList, spreadsheetPort);
    }

    // Scenario 2: Selection by number
    const choice = parseInt(trimmed, 10);
    if (!Number.isNaN(choice) && choice >= 1 && choice <= sheetList.length) {
      return this.confirmSheet(
        userId,
        externalId,
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
      return this.confirmSheet(userId, externalId, fileId, fileName, provider, matched, sheetList);
    }

    // Scenario 5: Invalid name — re-prompt
    const message = onboardingCopies.sheetNotFoundRePrompt(sheetList);
    await this.deps.messagingPort.sendMessage(externalId, message);
    return { nextState: 'ONBOARDING_SHEET', message };
  }

  private async handleIdk(
    userId: string,
    externalId: string,
    fileId: string,
    sheetList: SheetInfo[],
    spreadsheetPort: SpreadsheetPort,
  ): Promise<HandleSheetSelectionOutput> {
    try {
      const descriptions: string[] = [];
      for (const sheet of sheetList) {
        const headers = await spreadsheetPort.getHeaders(fileId, sheet.name);
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

  private async confirmSheet(
    userId: string,
    externalId: string,
    fileId: string,
    fileName: string,
    provider: SpreadsheetProvider,
    sheet: SheetInfo,
    sheetList?: SheetInfo[],
  ): Promise<HandleSheetSelectionOutput> {
    const message = onboardingCopies.sheetSelectedConfirmation(sheet.name);
    await this.deps.messagingPort.sendMessage(externalId, message);

    // Persist spreadsheet config
    await this.deps.spreadsheetConfigRepository.create({
      userId,
      provider,
      fileId,
      fileName,
      sheetName: sheet.name,
      accessVerifiedAt: new Date(),
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

    return { nextState: 'ONBOARDING_VALIDATING_ACCESS', message, payload };
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

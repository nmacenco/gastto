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

  async execute(
    input: ValidateSpreadsheetAccessInput,
  ): Promise<ValidateSpreadsheetAccessOutput> {
    const { userId, externalId, statePayload } = input;

    const provider = this.resolveProvider(statePayload);
    if (provider === 'microsoft') {
      const message = 'OneDrive validation is not yet supported.';
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_VALIDATING_ACCESS', message };
    }

    const token = await this.deps.tokenRepository.findByUserAndProvider(userId, provider);
    if (!token) {
      const message = 'No se pudo conectar. Hacé clic en el enlace de arriba para intentar de nuevo.';
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_VALIDATING_ACCESS', message };
    }

    if (token.revokedAt || isExpiredToken(token.accessTokenExpiresAt)) {
      const message = 'No se pudo conectar. Hacé clic en el enlace de arriba para intentar de nuevo.';
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_VALIDATING_ACCESS', message };
    }

    let accessToken: string;
    try {
      accessToken = this.deps.tokenEncryption.decrypt(token.accessTokenEnc, token.iv);
    } catch {
      const message = 'No se pudo conectar. Hacé clic en el enlace de arriba para intentar de nuevo.';
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_VALIDATING_ACCESS', message };
    }

    const fileId = statePayload?.selectedFileId as string;
    const sheetName = statePayload?.selectedSheetName as string;

    if (!fileId || typeof fileId !== 'string' || !sheetName || typeof sheetName !== 'string') {
      const message = 'No se pudo conectar. Hacé clic en el enlace de arriba para intentar de nuevo.';
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_VALIDATING_ACCESS', message };
    }

    const port = this.deps.validateSpreadsheetAccessPortFactory.create(provider, accessToken);
    const result = await port.validateSpreadsheetAccess(fileId, sheetName);

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
        const message =
          'Puedo ver tu planilla pero no tengo permiso para escribir en ella. Cambiá los permisos en Google Drive o OneDrive para que pueda escribir.';
        await this.deps.messagingPort.sendMessage(externalId, message);
        return { nextState: 'ONBOARDING_VALIDATING_ACCESS', message };
      }

      case 'empty-sheet': {
        const message = `La hoja *${sheetName}* parece estar vacía. ¿Es la correcta? Respondé *sí* para confirmar o elegí otra hoja.`;
        await this.deps.messagingPort.sendMessage(externalId, message);

        const payload = {
          selectedFileId: fileId,
          selectedFileName: statePayload?.selectedFileName as string,
          selectedSheetName: sheetName,
          provider,
          step: 'empty-sheet-confirm',
        };

        await this.deps.transitionState.execute({
          userId,
          targetState: 'ONBOARDING_SHEET',
          payload,
        });

        return { nextState: 'ONBOARDING_SHEET', message, payload };
      }

      case 'access-error': {
        const message =
          'No pude acceder a tu planilla. Intentá de nuevo o reconectá tu cuenta.';
        await this.deps.messagingPort.sendMessage(externalId, message);

        if (result.retryable) {
          return { nextState: 'ONBOARDING_START', message };
        }

        return { nextState: 'ONBOARDING_START', message };
      }
    }
  }

  private resolveProvider(statePayload: Record<string, unknown> | null): SpreadsheetProvider {
    const p = statePayload?.provider;
    if (p === 'microsoft') return 'microsoft';
    return 'google';
  }
}

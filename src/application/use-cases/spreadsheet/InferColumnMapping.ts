// LAYER: Application
// Use case: orchestrate the ONBOARDING_MAPPING state.
// Retrieves the OAuth token, loads the spreadsheet config, extracts the
// SpreadsheetPreview from the FSM state payload, invokes the column inference
// port, persists the inferred mappings, and sends a proposal message to the user.

import type {
  IOAuthTokenRepository,
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
} from '../../../domain/ports/repositories';
import type { TokenEncryptionPort } from '../../../domain/ports/tokenEncryption';
import type { ColumnInferencePort } from '../../../domain/ports/columnInference';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import { onboardingCopies } from '../../copies/onboarding.copies';

export interface InferColumnMappingInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}

export interface InferColumnMappingOutput {
  nextState: FsmState;
  message: string;
  payload?: Record<string, unknown>;
}

export interface InferColumnMappingDeps {
  tokenRepository: IOAuthTokenRepository;
  tokenEncryption: TokenEncryptionPort;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  columnMappingRepository: IColumnMappingRepository;
  columnInferencePort: ColumnInferencePort;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
}

function isExpiredToken(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export class InferColumnMapping {
  constructor(private readonly deps: InferColumnMappingDeps) {}

  async execute(input: InferColumnMappingInput): Promise<InferColumnMappingOutput> {
    const { userId, externalId, statePayload } = input;

    const provider = this.resolveProvider(statePayload);
    if (provider === 'microsoft') {
      const message = onboardingCopies.comingSoon('OneDrive');
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: 'ONBOARDING_MAPPING', message };
    }

    const token = await this.deps.tokenRepository.findByUserAndProvider(userId, provider);
    if (!token) {
      return this.handleReconnect(externalId, userId);
    }

    if (token.revokedAt || isExpiredToken(token.accessTokenExpiresAt)) {
      return this.handleReconnect(externalId, userId);
    }

    try {
      this.deps.tokenEncryption.decrypt(token.accessTokenEnc, token.iv);
    } catch {
      return this.handleReconnect(externalId, userId);
    }

    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) {
      return this.handleReconnect(externalId, userId);
    }

    const preview = statePayload?.preview as
      | {
          provider: string;
          fileId: string;
          sheetName: string;
          rows: Array<{ index: number; values: unknown[] }>;
        }
      | undefined;

    if (!preview || !Array.isArray(preview.rows) || preview.rows.length === 0) {
      const message = onboardingCopies.reconnectAccount();
      await this.deps.messagingPort.sendMessage(externalId, message);
      await this.deps.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
      });
      return { nextState: 'ONBOARDING_START', message };
    }

    const headers = preview.rows[0]!.values.map((v) => cellToString(v));
    const sampleRows = preview.rows
      .slice(1, 10)
      .map((row) => row.values.map((v) => cellToString(v)));

    const result = await this.deps.columnInferencePort.infer(headers, sampleRows);

    await this.deps.columnMappingRepository.upsertMany(
      result.mappings.map((m) => ({
        spreadsheetId: config.id,
        GasttoField: m.gasttoField,
        columnIndex: m.columnIndex,
        columnHeader: m.columnHeader,
        inferred: true,
        confirmedAt: null,
      })),
    );

    if (result.noHeaderFound) {
      const message = onboardingCopies.noHeaderPrompt();
      await this.deps.messagingPort.sendMessage(externalId, message);

      const payload: Record<string, unknown> = {
        ...statePayload,
        step: 'no-header',
      };

      await this.deps.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_MAPPING',
        payload,
      });

      return { nextState: 'ONBOARDING_MAPPING', message, payload };
    }

    const hasLowConfidence = result.mappings.some((m) => m.confidence === 'baja');
    const message =
      result.unmappedFields.length > 0
        ? hasLowConfidence
          ? onboardingCopies.mappingProposalLowConfidence(result.mappings, result.unmappedFields)
          : onboardingCopies.mappingProposalHighConfidence(result.mappings, result.unmappedFields)
        : hasLowConfidence
          ? onboardingCopies.mappingProposalLowConfidence(result.mappings, result.unmappedFields)
          : onboardingCopies.mappingProposalHighConfidence(result.mappings, result.unmappedFields);

    await this.deps.messagingPort.sendMessage(externalId, message);

    const payload: Record<string, unknown> = {
      ...statePayload,
      mappings: result.mappings,
      unmappedFields: result.unmappedFields,
    };

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_MAPPING',
      payload,
    });

    return { nextState: 'ONBOARDING_MAPPING', message, payload };
  }

  private async handleReconnect(
    externalId: string,
    userId: string,
  ): Promise<InferColumnMappingOutput> {
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
}

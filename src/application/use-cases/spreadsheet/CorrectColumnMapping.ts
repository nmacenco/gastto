// LAYER: Application
// Use case: apply a single user correction to the proposed column mapping.
// Parses the free-text message, validates the referenced column against the
// spreadsheet, accumulates the correction, and returns the updated mapping.

import type {
  IColumnMappingRepository,
  ISpreadsheetConfigRepository,
  IMappingCorrectionStateRepository,
  MappingCorrectionStateSnapshot,
  IOAuthTokenRepository,
} from '../../../domain/ports/repositories';
import type {
  ISpreadsheetColumnPort,
  AvailableColumn,
} from '../../../domain/ports/spreadsheetColumns';
import type { TokenEncryptionPort } from '../../../domain/ports/tokenEncryption';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type {
  ColumnMapping,
  GasttoField,
  SpreadsheetConfig,
} from '../../../domain/entities/SpreadsheetConfig';
import { ColumnMappingCorrectionState } from '../../../domain/value-objects/ColumnMappingCorrectionState';
import type { ColumnMappingCorrectionParser } from '../../services/ColumnMappingCorrectionParser';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { isRejectMappingIntent } from '../../utils/intents';
import type { HeaderDetectionPort } from '../../../domain/ports/headerDetection';
import type { ColumnInferencePort } from '../../../domain/ports/columnInference';
import type { Row } from '../../../domain/ports/services';

export interface CorrectColumnMappingInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  rawMessage: string;
  statePayload: Record<string, unknown> | null;
}

export interface CorrectColumnMappingUpdatedOutput {
  kind: 'updated';
  nextState: FsmState;
  message: string;
}

export interface CorrectColumnMappingInvalidColumnOutput {
  kind: 'invalid-column';
  nextState: FsmState;
  message: string;
  availableColumns: AvailableColumn[];
}

export interface CorrectColumnMappingParseFailureOutput {
  kind: 'parse-failure';
  nextState: FsmState;
  message: string;
}

export interface CorrectColumnMappingNoMappingOutput {
  kind: 'no-proposed-mapping';
  nextState: FsmState;
  message: string;
}

export interface CorrectColumnMappingReInferredOutput {
  kind: 're-inferred';
  nextState: FsmState;
  message: string;
  payload?: Record<string, unknown>;
}

export type CorrectColumnMappingOutput =
  | CorrectColumnMappingUpdatedOutput
  | CorrectColumnMappingInvalidColumnOutput
  | CorrectColumnMappingParseFailureOutput
  | CorrectColumnMappingNoMappingOutput
  | CorrectColumnMappingReInferredOutput;

export interface CorrectColumnMappingDeps {
  columnMappingRepository: IColumnMappingRepository;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  tokenRepository: IOAuthTokenRepository;
  tokenEncryption: TokenEncryptionPort;
  spreadsheetColumnPort: ISpreadsheetColumnPort;
  correctionParser: ColumnMappingCorrectionParser;
  correctionStateRepository: IMappingCorrectionStateRepository;
  headerDetectionPort: HeaderDetectionPort;
  llmHeaderDetectionPort: HeaderDetectionPort;
  llmColumnInferencePort: ColumnInferencePort;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
  stateTtlSeconds: number;
}

function isExpiredToken(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

function columnLetterToIndex(letters: string): number | null {
  const normalized = letters.toUpperCase().trim();
  if (!/^[A-Z]+$/.test(normalized)) return null;

  let index = 0;
  for (const char of normalized) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function extractPreviewRows(statePayload: Record<string, unknown> | null): Row[] | null {
  const preview = statePayload?.preview as
    | {
        provider: string;
        fileId: string;
        sheetName: string;
        rows: Array<{ index: number; values: unknown[] }>;
      }
    | undefined;

  if (!preview || !Array.isArray(preview.rows) || preview.rows.length === 0) {
    return null;
  }

  return preview.rows.map((r) => ({
    index: r.index,
    values: r.values as (string | number | boolean | null)[],
  }));
}

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveColumnRef(
  columnRef: string,
  availableColumns: AvailableColumn[],
): AvailableColumn | null {
  // Try letter reference (A, B, ..., AA)
  const letterIndex = columnLetterToIndex(columnRef);
  if (letterIndex !== null) {
    const match = availableColumns.find((c) => c.index === letterIndex);
    if (match) return match;
  }

  // Try numeric reference (1-based)
  const numericIndex = Number(columnRef);
  if (!Number.isNaN(numericIndex) && numericIndex > 0) {
    const match = availableColumns.find((c) => c.index === numericIndex - 1);
    if (match) return match;
  }

  // Try header name (case-insensitive, accent-insensitive)
  const normalizedRef = normalizeHeader(columnRef);
  const match = availableColumns.find((c) => normalizeHeader(c.columnHeader) === normalizedRef);
  if (match) return match;

  return null;
}

function buildSnapshot(state: ColumnMappingCorrectionState): MappingCorrectionStateSnapshot {
  return {
    originalMapping: [...state.originalMapping],
    corrections: [...state.corrections],
    status: state.status,
  };
}

function restoreSnapshot(snapshot: MappingCorrectionStateSnapshot): ColumnMappingCorrectionState {
  let state = ColumnMappingCorrectionState.create(snapshot.originalMapping);
  for (const correction of snapshot.corrections) {
    state = state.applyCorrection(correction);
  }
  return state;
}

function toDisplayMapping(mapping: ColumnMapping) {
  return {
    gasttoField: mapping.GasttoField,
    columnIndex: mapping.columnIndex,
    columnHeader: mapping.columnHeader,
  };
}

export class CorrectColumnMapping {
  constructor(private readonly deps: CorrectColumnMappingDeps) {}

  async execute(input: CorrectColumnMappingInput): Promise<CorrectColumnMappingOutput> {
    const { userId, externalId, rawMessage } = input;

    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) {
      return this.handleReconnect(externalId, userId);
    }

    const originalMappings = await this.deps.columnMappingRepository.findBySpreadsheetId(config.id);
    if (originalMappings.length === 0) {
      const message = onboardingCopies.noMappingToConfirm();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { kind: 'no-proposed-mapping', nextState: 'ONBOARDING_MAPPING', message };
    }

    const parseResult = this.deps.correctionParser.parse(rawMessage);
    if (parseResult.kind === 'failure') {
      if (isRejectMappingIntent(rawMessage)) {
        return this.handleRejection(input, config);
      }

      const message = onboardingCopies.correctionParseFailurePrompt();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { kind: 'parse-failure', nextState: 'ONBOARDING_MAPPING', message };
    }

    const token = await this.deps.tokenRepository.findByUserAndProvider(userId, config.provider);
    if (!token || token.revokedAt || isExpiredToken(token.accessTokenExpiresAt)) {
      return this.handleReconnect(externalId, userId);
    }

    let accessToken: string;
    try {
      accessToken = this.deps.tokenEncryption.decrypt(token.accessTokenEnc, token.iv);
    } catch {
      return this.handleReconnect(externalId, userId);
    }

    const availableColumns = await this.deps.spreadsheetColumnPort.listAvailableColumns({
      provider: config.provider,
      fileId: config.fileId,
      sheetName: config.sheetName,
      accessToken,
    });

    const matchedColumn = resolveColumnRef(parseResult.columnRef, availableColumns);
    if (!matchedColumn) {
      const message = onboardingCopies.invalidColumnPrompt(parseResult.columnRef, availableColumns);
      await this.deps.messagingPort.sendMessage(externalId, message);
      return {
        kind: 'invalid-column',
        nextState: 'ONBOARDING_MAPPING',
        message,
        availableColumns,
      };
    }

    const snapshot = await this.deps.correctionStateRepository.load(userId);
    const correctionState = snapshot
      ? restoreSnapshot(snapshot)
      : ColumnMappingCorrectionState.create(originalMappings);

    const updatedState = correctionState.applyCorrection({
      field: parseResult.field,
      columnIndex: matchedColumn.index,
      columnHeader: matchedColumn.columnHeader,
    });

    await this.deps.correctionStateRepository.save(
      userId,
      buildSnapshot(updatedState),
      this.deps.stateTtlSeconds,
    );

    const currentMappings = updatedState.getCurrentMapping();
    const unmappedFields: GasttoField[] = []; // Corrections do not introduce unmapped fields.

    const message = onboardingCopies.mappingUpdatedConfirmation(
      currentMappings.map(toDisplayMapping),
      unmappedFields,
    );
    await this.deps.messagingPort.sendMessage(externalId, message);

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_MAPPING',
      payload: {
        provider: config.provider,
        fileId: config.fileId,
        sheetName: config.sheetName,
        mappings: currentMappings.map(toDisplayMapping),
        unmappedFields,
      },
      expiresAt: this.computeExpiresAt(),
    });

    return { kind: 'updated', nextState: 'ONBOARDING_MAPPING', message };
  }

  private async handleRejection(
    input: CorrectColumnMappingInput,
    config: SpreadsheetConfig,
  ): Promise<CorrectColumnMappingOutput> {
    const { userId, externalId, statePayload } = input;

    const previewRows = extractPreviewRows(statePayload);
    if (!previewRows) {
      const message = onboardingCopies.correctionParseFailurePrompt();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { kind: 'parse-failure', nextState: 'ONBOARDING_MAPPING', message };
    }

    let headerRowIndex = await this.deps.headerDetectionPort.detectHeaderRow(previewRows);
    if (headerRowIndex === null) {
      headerRowIndex = await this.deps.llmHeaderDetectionPort.detectHeaderRow(previewRows);
    }

    if (headerRowIndex === null) {
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
        expiresAt: this.computeExpiresAt(),
      });

      return { kind: 'parse-failure', nextState: 'ONBOARDING_MAPPING', message };
    }

    const headerRow = previewRows.find((r) => r.index === headerRowIndex);
    if (!headerRow) {
      const message = onboardingCopies.correctionParseFailurePrompt();
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { kind: 'parse-failure', nextState: 'ONBOARDING_MAPPING', message };
    }

    const headers = headerRow.values.map((v) => cellToString(v));
    const sampleRows = previewRows
      .filter((row) => row.index > headerRowIndex)
      .slice(0, 9)
      .map((row) => row.values.map((v) => cellToString(v)));

    const result = await this.deps.llmColumnInferencePort.infer(headers, sampleRows);

    if (result.noHeaderFound || result.mappings.length === 0) {
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
        expiresAt: this.computeExpiresAt(),
      });

      return { kind: 'parse-failure', nextState: 'ONBOARDING_MAPPING', message };
    }

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
      expiresAt: this.computeExpiresAt(),
    });

    return { kind: 're-inferred', nextState: 'ONBOARDING_MAPPING', message, payload };
  }

  private async handleReconnect(
    externalId: string,
    userId: string,
  ): Promise<CorrectColumnMappingOutput> {
    const message = onboardingCopies.reconnectAccount();
    await this.deps.messagingPort.sendMessage(externalId, message);

    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });

    return { kind: 'no-proposed-mapping', nextState: 'ONBOARDING_START', message };
  }

  private computeExpiresAt(): Date {
    return new Date(Date.now() + this.deps.stateTtlSeconds * 1000);
  }
}

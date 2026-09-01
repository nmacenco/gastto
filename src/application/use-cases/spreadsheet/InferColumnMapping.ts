// LAYER: Application
// Use case: orchestrate the ONBOARDING_MAPPING state.
// Retrieves the OAuth token, loads the spreadsheet config, extracts the
// SpreadsheetPreview from the FSM state payload, invokes the column inference
// port, persists the inferred mappings, and sends a proposal message to the user.

import type {
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
} from '../../../domain/ports/repositories';
import type {
  ColumnInferencePort,
  ColumnInferenceResult,
  ColumnInferenceMapping,
} from '../../../domain/ports/columnInference';
import type { HeaderDetectionPort } from '../../../domain/ports/headerDetection';
import type { GasttoField } from '../../../domain/entities/SpreadsheetConfig';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import { onboardingCopies } from '../../copies/onboarding.copies';
import type { OAuthAccessTokenProvider } from '../../services/OAuthAccessTokenService';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

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
  oauthAccessTokenService: OAuthAccessTokenProvider;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  columnMappingRepository: IColumnMappingRepository;
  columnInferencePort: ColumnInferencePort;
  llmColumnInferencePort: ColumnInferencePort;
  headerDetectionPort: HeaderDetectionPort;
  llmHeaderDetectionPort: HeaderDetectionPort;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
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

    try {
      await this.deps.oauthAccessTokenService.getValidAccessToken({ userId, provider });
    } catch (error) {
      if (error instanceof SpreadsheetError && error.code === 'AUTH_ERROR') {
        return this.handleReconnect(externalId, userId);
      }
      throw error;
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

    const previewRows = preview.rows.map((r) => ({
      index: r.index,
      values: r.values as (string | number | boolean | null)[],
    }));

    let headerRowIndex: number | null =
      typeof statePayload?.headerRowIndex === 'number' ? statePayload.headerRowIndex : null;

    if (headerRowIndex === null) {
      headerRowIndex = await this.deps.headerDetectionPort.detectHeaderRow(previewRows);
    }

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
      });

      return { nextState: 'ONBOARDING_MAPPING', message, payload };
    }

    const headerRow = preview.rows.find((r) => r.index === headerRowIndex);
    if (!headerRow) {
      const message = onboardingCopies.reconnectAccount();
      await this.deps.messagingPort.sendMessage(externalId, message);
      await this.deps.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
      });
      return { nextState: 'ONBOARDING_START', message };
    }

    const headers = headerRow.values.map((v) => cellToString(v));
    const sampleRows = preview.rows
      .filter((row) => row.index > headerRowIndex)
      .slice(0, 9)
      .map((row) => row.values.map((v) => cellToString(v)));

    let result = await this.deps.columnInferencePort.infer(headers, sampleRows);

    const shouldRunLLM =
      result.noHeaderFound ||
      result.unmappedFields.length > 0 ||
      result.mappings.some((m) => m.confidence === 'baja');

    if (shouldRunLLM) {
      const llmResult = await this.deps.llmColumnInferencePort.infer(headers, sampleRows);
      result = this.mergeResults(result, llmResult);
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

    const looksLikePartialTitleRow =
      headerRowIndex === 1 && result.mappings.length <= 1 && preview.rows.length > 1;

    if (result.mappings.length === 0 || looksLikePartialTitleRow) {
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

    const { step: _step, ...restState } = statePayload ?? {};
    const payload: Record<string, unknown> = {
      ...restState,
      mappings: result.mappings,
      unmappedFields: result.unmappedFields,
      headerRowIndex,
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

  private mergeResults(
    ruleBased: ColumnInferenceResult,
    llm: ColumnInferenceResult,
  ): ColumnInferenceResult {
    const allFields: GasttoField[] = [
      'monto',
      'moneda',
      'categoria',
      'fecha',
      'concepto',
      'medio_pago',
    ];
    const llmByField = new Map(llm.mappings.map((m) => [m.gasttoField, m]));

    const mergedMappings: ColumnInferenceMapping[] = [];
    const usedColumns = new Set<number>();
    const mappedFields = new Set<GasttoField>();

    // First pass: keep high-confidence rule-based mappings in their original order.
    for (const mapping of ruleBased.mappings) {
      if (mapping.confidence === 'alta' && !usedColumns.has(mapping.columnIndex)) {
        mergedMappings.push(mapping);
        usedColumns.add(mapping.columnIndex);
        mappedFields.add(mapping.gasttoField);
      }
    }

    // Second pass: override low-confidence rule-based mappings with LLM where available,
    // preserving the original rule-based order.
    for (const mapping of ruleBased.mappings) {
      if (mapping.confidence === 'alta') continue;

      const llmMapping = llmByField.get(mapping.gasttoField);
      if (llmMapping && !usedColumns.has(llmMapping.columnIndex)) {
        mergedMappings.push(llmMapping);
        usedColumns.add(llmMapping.columnIndex);
        mappedFields.add(llmMapping.gasttoField);
      } else if (!usedColumns.has(mapping.columnIndex)) {
        mergedMappings.push(mapping);
        usedColumns.add(mapping.columnIndex);
        mappedFields.add(mapping.gasttoField);
      }
    }

    // Third pass: add LLM mappings for fields that rule-based did not map at all.
    for (const field of allFields) {
      if (mappedFields.has(field)) continue;

      const llmMapping = llmByField.get(field);
      if (llmMapping && !usedColumns.has(llmMapping.columnIndex)) {
        mergedMappings.push(llmMapping);
        usedColumns.add(llmMapping.columnIndex);
        mappedFields.add(llmMapping.gasttoField);
      }
    }

    const unmappedFields = allFields.filter((f) => !mappedFields.has(f));

    return {
      mappings: mergedMappings,
      noHeaderFound: ruleBased.noHeaderFound && llm.noHeaderFound,
      unmappedFields,
    };
  }

  private resolveProvider(statePayload: Record<string, unknown> | null): SpreadsheetProvider {
    const p = statePayload?.provider;
    if (p === 'microsoft') return 'microsoft';
    return 'google';
  }
}

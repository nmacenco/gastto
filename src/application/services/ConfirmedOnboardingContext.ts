// LAYER: Application
// Bind downstream onboarding reads to the destination and rows actually confirmed.
import type { ColumnMapping, SpreadsheetConfig } from '../../domain/entities/SpreadsheetConfig';
import type { TransitionConversationState } from '../use-cases/conversation/TransitionConversationState';
import { StaleConversationStateError } from '../../domain/errors/StaleConversationStateError';
import { readActiveColumnMappingProposal } from './ActiveColumnMappingProposal';

export function onboardingContextIssue(
  userId: string,
  config: SpreadsheetConfig,
  payload: Record<string, unknown> | null,
  mappings?: readonly ColumnMapping[],
): string | null {
  if (config.userId !== userId || !config.isActive) return 'configuration_ownership';
  for (const [key, value] of Object.entries({
    spreadsheetId: config.id,
    provider: config.provider,
    fileId: config.fileId,
    sheetName: config.sheetName,
  })) {
    if (payload?.[key] !== undefined && payload[key] !== value) return 'destination_changed';
  }
  if (payload?.confirmedMappings === undefined) return null; // Legacy drafts: presentation migration is separate.
  if (typeof payload.proposalId !== 'string' || !payload.proposalId) return 'proposal_missing';
  if (payload.headerRowIndex !== (config.headerRowIndex ?? 1)) return 'header_changed';
  const proposal = readActiveColumnMappingProposal(
    { ...payload, mappings: payload.confirmedMappings },
    config,
  );
  if (!proposal || !mappings || proposal.mappings.length !== mappings.length)
    return 'mappings_changed';
  const snapshots = payload.confirmedMappings as Record<string, unknown>[];
  for (const expected of proposal.mappings) {
    const row = mappings.find((mapping) => mapping.GasttoField === expected.GasttoField);
    const snapshot = snapshots.find((mapping) => mapping.gasttoField === expected.GasttoField);
    if (
      !row ||
      row.spreadsheetId !== config.id ||
      row.columnIndex !== expected.columnIndex ||
      row.columnHeader !== expected.columnHeader ||
      !row.confirmedAt ||
      row.confirmedAt.toISOString() !== snapshot?.confirmedAt
    )
      return 'mappings_changed';
  }
  return null;
}

export function mappingRecoveryPayload(config: SpreadsheetConfig): Record<string, unknown> {
  return {
    spreadsheetId: config.id,
    provider: config.provider,
    fileId: config.fileId,
    sheetName: config.sheetName,
    headerRowIndex: config.headerRowIndex ?? 1,
  };
}

// A direct caller must not pair a current execution revision with an older proposal.
export function assertCurrentOnboardingProposal(
  transition: TransitionConversationState,
  userId: string,
  payload: Record<string, unknown> | null,
): void {
  if (payload?.proposalId === undefined) return;
  const observed = transition.currentState(userId);
  if (
    observed?.statePayload?.proposalId !== undefined &&
    observed.statePayload.proposalId !== payload.proposalId
  ) {
    throw new StaleConversationStateError({ status: 'stale' });
  }
}

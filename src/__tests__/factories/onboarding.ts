// Shared persisted-draft fixtures. Lifecycle tests exercise actual delivery separately.
import { categoryProposalFingerprint } from '../../application/dtos/CategoryOnboardingState';
import type { ColumnMapping } from '../../domain/entities/SpreadsheetConfig';
import type { ConversationState } from '../../domain/entities/ConversationState';

export function buildConfirmedMappings(spreadsheetId = 'config-1'): ColumnMapping[] {
  return [
    {
      id: 'category',
      spreadsheetId,
      GasttoField: 'categoria',
      columnIndex: 2,
      columnHeader: 'Categoría',
      inferred: false,
      confirmedAt: new Date('2026-11-24T12:00:00Z'),
    },
    {
      id: 'payment',
      spreadsheetId,
      GasttoField: 'medio_pago',
      columnIndex: 4,
      columnHeader: 'Pago',
      inferred: false,
      confirmedAt: new Date('2026-11-24T12:00:00Z'),
    },
  ];
}

export function buildPresentedCategoryPayload(
  payload: Record<string, unknown>,
  mappings = buildConfirmedMappings(),
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    spreadsheetId: mappings[0]?.spreadsheetId ?? 'config-1',
    provider: 'google',
    fileId: 'file-123',
    sheetName: 'Gastos',
    headerRowIndex: 1,
    proposalId: 'mapping-proposal',
    ...payload,
    confirmedMappings: mappings.map((row) => ({
      gasttoField: row.GasttoField,
      columnIndex: row.columnIndex,
      columnHeader: row.columnHeader,
      confirmedAt: row.confirmedAt!.toISOString(),
    })),
    categoryProposalId: 'category-proposal',
    categoryPresentation: null,
    categoryAcceptance: null,
  };
  const fingerprint = categoryProposalFingerprint(result);
  result.categoryPresentation = {
    proposalId: result.categoryProposalId,
    fingerprint,
    presentedAt: '2026-11-24T12:01:00.000Z',
  };
  if (result.paymentReview === true)
    result.categoryAcceptance = { proposalId: result.categoryProposalId, fingerprint };
  return result;
}

export function buildCategoryConversationState(
  payload: Record<string, unknown> | null,
  revision = '1',
): ConversationState {
  return {
    userId: 'user-123',
    currentState: 'ONBOARDING_CATEGORIES',
    statePayload: payload,
    revision,
    expiresAt: null,
    enteredAt: new Date(),
    updatedAt: new Date(),
  };
}

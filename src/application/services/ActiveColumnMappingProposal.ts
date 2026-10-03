// LAYER: Application
// Validates and materializes the column-mapping proposal stored in the FSM payload.

import type {
  ColumnMapping,
  GasttoField,
  SpreadsheetConfig,
} from '../../domain/entities/SpreadsheetConfig';
import { SUPPORTED_GASTTO_FIELDS } from '../../domain/entities/SpreadsheetConfig';

export interface ActiveColumnMappingProposal {
  proposalId: string;
  mappings: ColumnMapping[];
}

export function readActiveColumnMappingProposal(
  payload: Record<string, unknown> | null,
  config: SpreadsheetConfig,
): ActiveColumnMappingProposal | null {
  if (!payload || !Array.isArray(payload.mappings)) return null;
  if (payload.spreadsheetId !== undefined && payload.spreadsheetId !== config.id) return null;
  if (payload.provider !== undefined && payload.provider !== config.provider) return null;
  if (payload.fileId !== undefined && payload.fileId !== config.fileId) return null;
  if (payload.sheetName !== undefined && payload.sheetName !== config.sheetName) return null;

  const mappings: ColumnMapping[] = [];
  const fields = new Set<GasttoField>();
  const columns = new Set<number>();

  for (const value of payload.mappings) {
    if (!isRecord(value)) return null;
    const field = value.gasttoField;
    const columnIndex = value.columnIndex;
    const columnHeader = value.columnHeader;
    if (
      typeof field !== 'string' ||
      !SUPPORTED_GASTTO_FIELDS.includes(field as GasttoField) ||
      typeof columnIndex !== 'number' ||
      !Number.isInteger(columnIndex) ||
      columnIndex < 0 ||
      typeof columnHeader !== 'string'
    ) {
      return null;
    }

    const typedField = field as GasttoField;
    if (fields.has(typedField) || columns.has(columnIndex)) return null;
    fields.add(typedField);
    columns.add(columnIndex);
    mappings.push({
      id: typeof value.id === 'string' ? value.id : `proposal:${typedField}`,
      spreadsheetId: config.id,
      GasttoField: typedField,
      columnIndex,
      columnHeader,
      inferred: typeof value.inferred === 'boolean' ? value.inferred : true,
      confirmedAt: null,
    });
  }

  if (mappings.length === 0) return null;
  const proposalId =
    typeof payload.proposalId === 'string' && payload.proposalId.length > 0
      ? payload.proposalId
      : `legacy:${config.id}:${config.fileId}:${config.sheetName}`;
  return { proposalId, mappings };
}

export function toProposalPayloadMapping(
  mapping: Pick<ColumnMapping, 'GasttoField' | 'columnIndex' | 'columnHeader' | 'inferred'>,
) {
  return {
    gasttoField: mapping.GasttoField,
    columnIndex: mapping.columnIndex,
    columnHeader: mapping.columnHeader,
    inferred: mapping.inferred,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

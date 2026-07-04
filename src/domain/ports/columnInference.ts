// LAYER: Domain
// Port for inferring column mappings from spreadsheet headers and sample data.
// Keeps the Application layer agnostic of the inference strategy
// (rule-based, LLM-powered, etc.).

import type { GasttoField } from '../entities/SpreadsheetConfig';

export type ConfidenceLevel = 'alta' | 'baja';

export interface ColumnInferenceMapping {
  gasttoField: GasttoField;
  columnIndex: number;
  columnHeader: string;
  confidence: ConfidenceLevel;
}

export interface ColumnInferenceResult {
  mappings: ColumnInferenceMapping[];
  noHeaderFound: boolean;
  unmappedFields: GasttoField[];
}

export interface ColumnInferencePort {
  infer(headers: string[], sampleRows: string[][]): Promise<ColumnInferenceResult>;
}

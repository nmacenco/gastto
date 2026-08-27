// LAYER: Domain
// Transient state for the column-mapping confirmation/correction flow.
// Keeps the original inferred mapping and any user corrections immutable.

import type { ColumnMapping, GasttoField } from '../entities/SpreadsheetConfig';

export type MappingCorrectionStatus = 'proposed' | 'correcting' | 'confirmed';

export interface MappingCorrection {
  field: GasttoField;
  columnIndex: number;
  columnHeader: string;
}

export type CurrentColumnMapping = Omit<ColumnMapping, 'id'> & { readonly id?: string };

export class ColumnMappingCorrectionState {
  private constructor(
    public readonly originalMapping: readonly ColumnMapping[],
    public readonly corrections: readonly MappingCorrection[],
    public readonly status: MappingCorrectionStatus,
  ) {}

  static create(originalMapping: readonly ColumnMapping[]): ColumnMappingCorrectionState {
    return new ColumnMappingCorrectionState(originalMapping, [], 'proposed');
  }

  applyCorrection(correction: MappingCorrection): ColumnMappingCorrectionState {
    return new ColumnMappingCorrectionState(
      this.originalMapping,
      [...this.corrections.filter((c) => c.field !== correction.field), correction],
      'correcting',
    );
  }

  confirm(): ColumnMappingCorrectionState {
    return new ColumnMappingCorrectionState(this.originalMapping, this.corrections, 'confirmed');
  }

  getCurrentMapping(): CurrentColumnMapping[] {
    const correctedMappings = this.originalMapping.map((mapping) => {
      const correction = this.corrections.find((c) => c.field === mapping.GasttoField);
      if (!correction) return mapping;

      return {
        ...mapping,
        columnIndex: correction.columnIndex,
        columnHeader: correction.columnHeader,
        inferred: false,
      };
    });

    const originalFields = new Set(this.originalMapping.map((mapping) => mapping.GasttoField));
    const spreadsheetId = this.originalMapping[0]?.spreadsheetId;

    if (!spreadsheetId) return correctedMappings;

    const newlyMappedFields = this.corrections
      .filter((correction) => !originalFields.has(correction.field))
      .map(
        (correction): CurrentColumnMapping => ({
          spreadsheetId,
          GasttoField: correction.field,
          columnIndex: correction.columnIndex,
          columnHeader: correction.columnHeader,
          inferred: false,
          confirmedAt: null,
        }),
      );

    return [...correctedMappings, ...newlyMappedFields];
  }
}

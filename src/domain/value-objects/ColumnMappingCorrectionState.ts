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

  getCurrentMapping(): ColumnMapping[] {
    return this.originalMapping.map((mapping) => {
      const correction = this.corrections.find((c) => c.field === mapping.GasttoField);
      if (!correction) return mapping;

      return {
        ...mapping,
        columnIndex: correction.columnIndex,
        columnHeader: correction.columnHeader,
      };
    });
  }
}

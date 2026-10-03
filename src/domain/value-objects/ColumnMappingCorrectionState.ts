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
    public readonly unmappedFields: readonly GasttoField[],
    public readonly status: MappingCorrectionStatus,
  ) {}

  static create(originalMapping: readonly ColumnMapping[]): ColumnMappingCorrectionState {
    return new ColumnMappingCorrectionState(originalMapping, [], [], 'proposed');
  }

  static restore(
    originalMapping: readonly ColumnMapping[],
    corrections: readonly MappingCorrection[],
    unmappedFields: readonly GasttoField[] = [],
  ): ColumnMappingCorrectionState {
    return new ColumnMappingCorrectionState(
      originalMapping,
      corrections,
      unmappedFields,
      corrections.length > 0 ? 'correcting' : 'proposed',
    );
  }

  applyCorrection(correction: MappingCorrection): ColumnMappingCorrectionState {
    const occupant = this.getCurrentMapping().find(
      (mapping) =>
        mapping.columnIndex === correction.columnIndex && mapping.GasttoField !== correction.field,
    );
    const unmappedFields = new Set(this.unmappedFields);
    unmappedFields.delete(correction.field);
    if (occupant) unmappedFields.add(occupant.GasttoField);

    return new ColumnMappingCorrectionState(
      this.originalMapping,
      [...this.corrections.filter((c) => c.field !== correction.field), correction],
      [...unmappedFields],
      'correcting',
    );
  }

  confirm(): ColumnMappingCorrectionState {
    return new ColumnMappingCorrectionState(
      this.originalMapping,
      this.corrections,
      this.unmappedFields,
      'confirmed',
    );
  }

  getCurrentMapping(): CurrentColumnMapping[] {
    const correctedMappings = this.originalMapping
      .filter((mapping) => !this.unmappedFields.includes(mapping.GasttoField))
      .map((mapping) => {
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
      .filter(
        (correction) =>
          !originalFields.has(correction.field) && !this.unmappedFields.includes(correction.field),
      )
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

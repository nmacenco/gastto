// LAYER: Domain
// Immutable entity representing a preview of the first rows of a spreadsheet sheet.
// Validation is performed at construction time; invalid data cannot exist.

import { DomainValidationError } from '../errors/DomainValidationError';
import type { SpreadsheetProvider } from './SpreadsheetConfig';
import type { Row } from '../ports/services';

export interface SpreadsheetPreviewProps {
  readonly provider: SpreadsheetProvider;
  readonly fileId: string;
  readonly sheetName: string;
  readonly rows: readonly Row[];
}

export class SpreadsheetPreview implements SpreadsheetPreviewProps {
  readonly provider: SpreadsheetProvider;
  readonly fileId: string;
  readonly sheetName: string;
  readonly rows: readonly Row[];

  constructor(props: SpreadsheetPreviewProps) {
    if (props.provider !== 'google' && props.provider !== 'microsoft') {
      throw new DomainValidationError('provider must be "google" or "microsoft"');
    }
    if (!props.fileId || props.fileId.trim().length === 0) {
      throw new DomainValidationError('fileId is required and cannot be empty');
    }
    if (!props.sheetName || props.sheetName.trim().length === 0) {
      throw new DomainValidationError('sheetName is required and cannot be empty');
    }
    if (!Array.isArray(props.rows)) {
      throw new DomainValidationError('rows must be an array');
    }

    this.provider = props.provider;
    this.fileId = props.fileId.trim();
    this.sheetName = props.sheetName.trim();
    this.rows = Array.from(props.rows);

    Object.freeze(this);
  }

  equals(other: SpreadsheetPreview): boolean {
    return (
      this.provider === other.provider &&
      this.fileId === other.fileId &&
      this.sheetName === other.sheetName &&
      this.rows.length === other.rows.length &&
      this.rows.every((row, i) => {
        const otherRow = other.rows[i];
        if (!otherRow) return false;
        return (
          row.index === otherRow.index &&
          row.values.length === otherRow.values.length &&
          row.values.every((cell, j) => cell === otherRow.values[j])
        );
      })
    );
  }
}

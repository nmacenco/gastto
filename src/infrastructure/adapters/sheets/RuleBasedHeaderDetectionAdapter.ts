// LAYER: Infrastructure
// Rule-based header row detection adapter.
// Scans preview rows and prefers recognized headers over earlier generic
// label-like rows such as titles or summaries.

import type { HeaderDetectionPort } from '../../../domain/ports/headerDetection';
import type { Row } from '../../../domain/ports/services';
import { getExactGasttoField } from './columnHeaderVocabulary';

const DATE_REGEX = /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/;
const NUMERIC_REGEX = /^[+-]?\s*[\$€£R]?\s*\d{1,3}([.,]\d{3})*([.,]\d+)?\s*[\$€£R]?$/;
const CURRENCY_CODE_REGEX = /^(ARS|EUR|USD|MXN|GBP|BRL)$/i;

function isDateLike(value: string): boolean {
  return DATE_REGEX.test(value.trim());
}

function isNumericLike(value: string): boolean {
  return NUMERIC_REGEX.test(value.trim());
}

function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODE_REGEX.test(value.trim());
}

function isDataLike(value: string): boolean {
  return isDateLike(value) || isNumericLike(value) || isCurrencyCode(value);
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export class RuleBasedHeaderDetectionAdapter implements HeaderDetectionPort {
  detectHeaderRow(rows: Row[]): Promise<number | null> {
    let firstPlausibleRowIndex: number | null = null;
    let strongestRecognizedCandidate:
      | { rowIndex: number; recognizedFieldCount: number; labelCount: number }
      | undefined;

    for (const row of rows) {
      const values = row.values.map((v) => cellToString(v).trim()).filter((v) => v !== '');

      if (values.length < 2) {
        // A single non-empty value is usually a sheet title, not a header row.
        continue;
      }

      const allDataLike = values.every((v) => isDataLike(v));
      if (!allDataLike) {
        firstPlausibleRowIndex ??= row.index;

        const labelValues = values.filter((value) => !isDataLike(value));
        const recognizedFields = new Set(
          labelValues
            .map((value) => getExactGasttoField(value))
            .filter((field) => field !== undefined),
        );

        if (recognizedFields.size < 2) {
          continue;
        }

        const isStrongerCandidate =
          strongestRecognizedCandidate === undefined ||
          recognizedFields.size > strongestRecognizedCandidate.recognizedFieldCount ||
          (recognizedFields.size === strongestRecognizedCandidate.recognizedFieldCount &&
            labelValues.length > strongestRecognizedCandidate.labelCount);

        if (isStrongerCandidate) {
          strongestRecognizedCandidate = {
            rowIndex: row.index,
            recognizedFieldCount: recognizedFields.size,
            labelCount: labelValues.length,
          };
        }
      }
    }

    return Promise.resolve(strongestRecognizedCandidate?.rowIndex ?? firstPlausibleRowIndex);
  }
}

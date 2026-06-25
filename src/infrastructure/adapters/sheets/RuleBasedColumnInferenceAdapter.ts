// LAYER: Infrastructure
// Rule-based column inference adapter.
// Implements ColumnInferencePort using header normalization, multi-language
// dictionaries, fuzzy matching (Levenshtein), and content-type heuristics.

import type {
  ColumnInferencePort,
  ColumnInferenceResult,
  ColumnInferenceMapping,
  ConfidenceLevel,
} from '../../../domain/ports/columnInference';
import type { GasttoField } from '../../../domain/entities/SpreadsheetConfig';

const ALL_GASTTO_FIELDS: GasttoField[] = [
  'monto',
  'moneda',
  'categoria',
  'fecha',
  'concepto',
  'medio_pago',
];

const DICTIONARY: Record<string, GasttoField> = {
  fecha: 'fecha',
  dia: 'fecha',
  'dia del gasto': 'fecha',
  date: 'fecha',
  day: 'fecha',
  data: 'fecha',

  monto: 'monto',
  importe: 'monto',
  total: 'monto',
  cantidad: 'monto',
  precio: 'monto',
  valor: 'monto',
  amount: 'monto',
  price: 'monto',
  quantia: 'monto',

  categoria: 'categoria',
  tipo: 'categoria',
  rubro: 'categoria',
  category: 'categoria',
  type: 'categoria',

  concepto: 'concepto',
  descripcion: 'concepto',
  detalle: 'concepto',
  observacion: 'concepto',
  description: 'concepto',
  detail: 'concepto',
  descricao: 'concepto',
  observacoes: 'concepto',

  'medio de pago': 'medio_pago',
  'forma de pago': 'medio_pago',
  'payment method': 'medio_pago',
  'meio de pagamento': 'medio_pago',
  medio_pago: 'medio_pago',

  moneda: 'moneda',
  currency: 'moneda',
  moeda: 'moneda',
};

const NORMALIZED_DICTIONARY_KEYS = Object.keys(DICTIONARY);

const DATE_REGEX = /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/;
const NUMERIC_REGEX = /^[\$€£R]?\s*\d{1,3}([.,]\d{3})*([.,]\d+)?\s*[\$€£R]?$/;
const CURRENCY_CODE_REGEX = /^(ARS|EUR|USD|MXN|GBP|BRL)$/i;

function normalize(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow: number[] = [];
  for (let j = 0; j <= n; j++) {
    prevRow.push(j);
  }

  for (let i = 1; i <= m; i++) {
    const currRow: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = prevRow[j]! + 1;
      const insertion = currRow[j - 1]! + 1;
      const substitution = prevRow[j - 1]! + cost;
      currRow.push(Math.min(deletion, insertion, substitution));
    }
    prevRow = currRow;
  }

  return prevRow[n]!;
}

function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

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

function detectNoHeader(headers: string[]): boolean {
  if (headers.length === 0) return false;
  return headers.every((h) => isDataLike(h));
}

function validateContentType(
  field: GasttoField,
  columnIndex: number,
  sampleRows: string[][],
): boolean | null {
  if (sampleRows.length === 0) return null;

  const columnValues: string[] = [];
  for (const row of sampleRows) {
    const val = row[columnIndex];
    if (val !== undefined && val !== null && val !== '') {
      columnValues.push(val);
    }
  }

  if (columnValues.length === 0) return null;

  switch (field) {
    case 'fecha':
      return columnValues.some((v) => isDateLike(v));
    case 'monto':
      return columnValues.some((v) => isNumericLike(v));
    case 'moneda':
      return columnValues.some((v) => isCurrencyCode(v));
    default:
      return null;
  }
}

export class RuleBasedColumnInferenceAdapter implements ColumnInferencePort {
  infer(headers: string[], sampleRows: string[][]): Promise<ColumnInferenceResult> {
    if (headers.length === 0) {
      return Promise.resolve({
        mappings: [],
        noHeaderFound: false,
        unmappedFields: [...ALL_GASTTO_FIELDS],
      });
    }

    if (detectNoHeader(headers)) {
      return Promise.resolve({
        mappings: [],
        noHeaderFound: true,
        unmappedFields: [...ALL_GASTTO_FIELDS],
      });
    }

    const mappings: ColumnInferenceMapping[] = [];
    const mappedFields = new Set<GasttoField>();

    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
      const rawHeader = headers[colIdx] ?? '';
      const normalizedHeader = normalize(rawHeader);

      let matchedField: GasttoField | null = null;
      let confidence: ConfidenceLevel = 'baja';

      const exactMatch = DICTIONARY[normalizedHeader];
      if (exactMatch !== undefined) {
        matchedField = exactMatch;
        confidence = 'alta';
      } else {
        let bestRatio = 0;
        for (const dictKey of NORMALIZED_DICTIONARY_KEYS) {
          const ratio = levenshteinRatio(normalizedHeader, dictKey);
          if (ratio >= 0.75 && ratio > bestRatio) {
            bestRatio = ratio;
            const fuzzyMatch = DICTIONARY[dictKey];
            if (fuzzyMatch !== undefined) {
              matchedField = fuzzyMatch;
              confidence = 'baja';
            }
          }
        }
      }

      if (matchedField !== null && !mappedFields.has(matchedField)) {
        const contentValid = validateContentType(matchedField, colIdx, sampleRows);

        if (contentValid === true && confidence === 'baja') {
          confidence = 'alta';
        } else if (contentValid === false && confidence === 'alta') {
          confidence = 'baja';
        }

        mappings.push({
          gasttoField: matchedField,
          columnIndex: colIdx,
          columnHeader: rawHeader,
          confidence,
        });
        mappedFields.add(matchedField);
      }
    }

    const unmappedFields = ALL_GASTTO_FIELDS.filter((f) => !mappedFields.has(f));

    return Promise.resolve({ mappings, noHeaderFound: false, unmappedFields });
  }
}

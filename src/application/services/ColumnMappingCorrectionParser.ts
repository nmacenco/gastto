// LAYER: Application
// Parses free-text user messages that correct a proposed column mapping.
// Deterministic, dependency-free, and isolated behind an interface so an
// LLM-based adapter can replace it later without touching the use case.

import type { GasttoField } from '../../domain/entities/SpreadsheetConfig';

export type CorrectionParseResult =
  | { kind: 'success'; field: GasttoField; columnRef: string }
  | { kind: 'failure'; reason: string };

export interface ColumnMappingCorrectionParser {
  parse(message: string): CorrectionParseResult;
}

interface FieldMatcher {
  regex: RegExp;
  field: GasttoField;
}

const FIELD_MATCHERS: FieldMatcher[] = [
  { regex: /\b(categoria|rubro|tipo|category)\b/, field: 'categoria' },
  { regex: /\b(monto|amount|valor|importe|total|precio|costo)\b/, field: 'monto' },
  { regex: /\b(fecha|date|data|dia)\b/, field: 'fecha' },
  { regex: /\b(concepto|descripcion|description|detalle|motivo|nota)\b/, field: 'concepto' },
  { regex: /\b(moneda|currency|divisa)\b/, field: 'moneda' },
  {
    regex: /\b(medio\s+de\s+pago|metodo\s+de\s+pago|forma\s+de\s+pago|payment\s+method|tarjeta)\b/,
    field: 'medio_pago',
  },
];

export class RuleBasedColumnMappingCorrectionParser implements ColumnMappingCorrectionParser {
  parse(message: string): CorrectionParseResult {
    const normalized = this.normalize(message);

    const field = this.extractField(normalized);
    if (!field) {
      return { kind: 'failure', reason: 'No recognizable Gastto field found in the message' };
    }

    const columnRef = this.extractColumnRef(normalized);
    if (!columnRef) {
      return { kind: 'failure', reason: 'No recognizable column reference found in the message' };
    }

    return { kind: 'success', field, columnRef };
  }

  private normalize(message: string): string {
    return message
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[.,;:!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractField(normalized: string): GasttoField | null {
    for (const matcher of FIELD_MATCHERS) {
      if (matcher.regex.test(normalized)) {
        return matcher.field;
      }
    }
    return null;
  }

  private extractColumnRef(normalized: string): string | null {
    // Explicit column references: "columna E", "column 5", "col F"
    const explicitMatch = normalized.match(/(?:columna|column|col)\s*([a-z0-9]+)/);
    if (explicitMatch) {
      return this.cleanColumnRef(explicitMatch[1]!);
    }

    // Preposition + optional article/column + letter: "en E", "es la columna A", "va en B"
    const letterMatch = normalized.match(
      /(?:en|es|va|a|at|is|in)\s+(?:la\s+)?(?:columna\s+|column\s+|col\s+)?([a-z])\b/,
    );
    if (letterMatch) {
      return this.cleanColumnRef(letterMatch[1]!);
    }

    // Preposition + optional article/column + number: "en 5", "es la columna 3"
    const numberMatch = normalized.match(
      /(?:en|es|va|a|at|is|in)\s+(?:la\s+)?(?:columna\s+|column\s+|col\s+)?(\d+)\b/,
    );
    if (numberMatch) {
      return this.cleanColumnRef(numberMatch[1]!);
    }

    // Quoted header name: "la categoria es 'Categoría'"
    const quotedMatch = normalized.match(/["']([^"']+)["']/);
    if (quotedMatch) {
      return this.cleanColumnRef(quotedMatch[1]!);
    }

    return null;
  }

  private cleanColumnRef(raw: string): string {
    return raw.trim().toUpperCase();
  }
}

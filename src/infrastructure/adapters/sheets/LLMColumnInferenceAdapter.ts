// LAYER: Infrastructure
// LLM-powered column inference adapter.
// Implements ColumnInferencePort by asking an LLM to map spreadsheet headers
// to Gastto fields when rule-based inference is uncertain or incomplete.
// Parses the structured JSON response defensively and falls back to an empty
// result on any failure.

import { z } from 'zod';
import type { Logger } from 'pino';
import type {
  ColumnInferencePort,
  ColumnInferenceResult,
} from '../../../domain/ports/columnInference';
import type { GasttoField } from '../../../domain/entities/SpreadsheetConfig';
import type { LLMPort, ConversationContext } from '../../../domain/ports/services';

const ALL_GASTTO_FIELDS: GasttoField[] = [
  'monto',
  'moneda',
  'categoria',
  'fecha',
  'concepto',
  'medio_pago',
];

const GasttoFieldSchema = z.enum([
  'monto',
  'moneda',
  'categoria',
  'fecha',
  'concepto',
  'medio_pago',
]);

// Zod schema for the LLM structured response.
const ColumnInferenceResponseSchema = z.object({
  mappings: z.array(
    z.object({
      gasttoField: GasttoFieldSchema,
      columnIndex: z.number().int().nonnegative(),
      columnHeader: z.string(),
      confidence: z.enum(['alta', 'baja']),
    }),
  ),
  noHeaderFound: z.boolean(),
  unmappedFields: z.array(GasttoFieldSchema),
});

// Default conversation context used when the use case cannot provide one.
// generateResponse implementations currently ignore this parameter, but a
// sensible default keeps the adapter self-contained.
const DEFAULT_CONTEXT: ConversationContext = {
  userId: 'unknown',
  currentState: 'ONBOARDING_MAPPING',
  statePayload: null,
};

function buildPrompt(headers: string[], sampleRows: string[][]): string {
  return `Eres un asistente especializado en hojas de cálculo. Tu tarea es identificar qué columna corresponde a cada campo de Gastto.

Campos de Gastto:
- fecha: fecha del gasto
- monto: importe del gasto
- moneda: código de moneda (ARS, USD, EUR, etc.)
- categoria: categoría del gasto
- concepto: descripción o concepto del gasto
- medio_pago: medio o forma de pago

Reglas:
1. Devuelve cada campo que estés seguro de identificar con su índice de columna (base 0).
2. La confianza es "alta" cuando el encabezado o el contenido de las muestras dejan poca duda; "baja" cuando es una inferencia.
3. Si ninguna columna parece corresponder a un campo, inclúyelo en unmappedFields.
4. Si la fila proporcionada no parece contener encabezados, devuelve noHeaderFound: true.
5. Devuelve ÚNICAMENTE JSON puro, sin markdown, sin explicaciones.

Esquema de salida:
{
  "mappings": [
    { "gasttoField": "fecha", "columnIndex": 0, "columnHeader": "Fecha", "confidence": "alta" }
  ],
  "noHeaderFound": false,
  "unmappedFields": ["moneda", "medio_pago"]
}

Encabezados:
${JSON.stringify(headers)}

Filas de ejemplo:
${JSON.stringify(sampleRows)}`;
}

export class LLMColumnInferenceAdapter implements ColumnInferencePort {
  constructor(
    private readonly llmPort: LLMPort,
    private readonly logger?: Logger,
  ) {}

  async infer(headers: string[], sampleRows: string[][]): Promise<ColumnInferenceResult> {
    if (headers.length === 0) {
      return {
        mappings: [],
        noHeaderFound: true,
        unmappedFields: [...ALL_GASTTO_FIELDS],
      };
    }

    try {
      const prompt = buildPrompt(headers, sampleRows);
      const raw = await this.llmPort.generateResponse(prompt, DEFAULT_CONTEXT);
      const cleaned = raw.replace(/```json|```/g, '').trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        this.logger?.warn({
          msg: 'LLM column inference returned invalid JSON',
          rawResponse: raw,
        });
        return this.emptyResult();
      }

      const validated = ColumnInferenceResponseSchema.safeParse(parsed);
      if (!validated.success) {
        this.logger?.warn({
          msg: 'LLM column inference response failed schema validation',
          errors: validated.error.format(),
          parsed,
        });
        return this.emptyResult();
      }

      // Filter out mappings whose column index is outside the headers array.
      const validMappings = validated.data.mappings.filter((m) => m.columnIndex < headers.length);

      // Deduplicate by gasttoField and columnIndex, keeping the first occurrence.
      const seenFields = new Set<GasttoField>();
      const seenColumns = new Set<number>();
      const mappings = validMappings.filter((m) => {
        if (seenFields.has(m.gasttoField) || seenColumns.has(m.columnIndex)) {
          return false;
        }
        seenFields.add(m.gasttoField);
        seenColumns.add(m.columnIndex);
        return true;
      });

      const mappedFields = new Set(mappings.map((m) => m.gasttoField));
      const requestedUnmapped = new Set(validated.data.unmappedFields);
      const unmappedFields = ALL_GASTTO_FIELDS.filter(
        (f) => !mappedFields.has(f) || requestedUnmapped.has(f),
      );

      return {
        mappings,
        noHeaderFound: validated.data.noHeaderFound && mappings.length === 0,
        unmappedFields,
      };
    } catch (err) {
      this.logger?.error({
        msg: 'LLM column inference failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return this.emptyResult();
    }
  }

  private emptyResult(): ColumnInferenceResult {
    return {
      mappings: [],
      noHeaderFound: false,
      unmappedFields: [...ALL_GASTTO_FIELDS],
    };
  }
}

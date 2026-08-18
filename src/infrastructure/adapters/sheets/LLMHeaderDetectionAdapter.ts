// LAYER: Infrastructure
// LLM-powered header row detection adapter.
// Implements HeaderDetectionPort by asking an LLM to locate the header row
// when rule-based detection is uncertain. Parses the structured JSON response
// defensively and falls back to null on any failure.

import { z } from 'zod';
import type { Logger } from 'pino';
import type { HeaderDetectionPort } from '../../../domain/ports/headerDetection';
import type { LLMPort, Row, ConversationContext } from '../../../domain/ports/services';
import { serializeUntrustedData } from '../llm/untrustedData';

// Zod schema for the LLM structured response.
const HeaderDetectionResponseSchema = z.object({
  headerRowIndex: z.number().int().positive().nullable(),
});

// Default conversation context used when the use case cannot provide one.
// generateResponse implementations currently ignore this parameter, but a
// sensible default keeps the adapter self-contained.
const DEFAULT_CONTEXT: ConversationContext = {
  userId: 'unknown',
  currentState: 'ONBOARDING_MAPPING',
  statePayload: null,
};

function buildPrompt(rows: Row[]): string {
  return `Eres un asistente especializado en hojas de cálculo. Tu tarea es identificar qué fila contiene los encabezados de columnas.

Te paso las primeras filas de una hoja en formato JSON. Cada fila tiene:
- "index": número de fila (base 1).
- "values": lista de valores de celdas.

Reglas:
1. Los encabezados son etiquetas de texto como "Fecha", "Monto", "Categoría", "Descripción", "Medio de pago", "Moneda".
2. Una fila cuyos valores sean solo fechas, números o códigos de moneda NO es un encabezado.
3. Si no hay una fila clara de encabezados, devuelve {"headerRowIndex": null}.
4. Devuelve ÚNICAMENTE JSON puro, sin markdown, sin explicaciones.

Esquema de salida:
{"headerRowIndex": number | null}

Filas no confiables:
${serializeUntrustedData({ rows })}`;
}

export class LLMHeaderDetectionAdapter implements HeaderDetectionPort {
  constructor(
    private readonly llmPort: LLMPort,
    private readonly logger?: Logger,
  ) {}

  async detectHeaderRow(rows: Row[]): Promise<number | null> {
    if (rows.length === 0) {
      return null;
    }

    try {
      const prompt = buildPrompt(rows);
      const raw = await this.llmPort.generateResponse(prompt, DEFAULT_CONTEXT);
      const cleaned = raw.replace(/```json|```/g, '').trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        this.logger?.warn({
          msg: 'LLM header detection returned invalid JSON',
          code: 'LLM_INVALID_JSON',
        });
        return null;
      }

      const validated = HeaderDetectionResponseSchema.safeParse(parsed);
      if (!validated.success) {
        this.logger?.warn({
          msg: 'LLM header detection response failed schema validation',
          code: 'LLM_SCHEMA_VALIDATION_FAILED',
          validationPaths: validated.error.issues.map((issue) => issue.path.join('.')),
        });
        return null;
      }

      const index = validated.data.headerRowIndex;
      if (index === null) {
        return null;
      }

      const exists = rows.some((row) => row.index === index);
      if (!exists) {
        this.logger?.warn({
          msg: 'LLM header detection returned a row index outside the provided preview',
          headerRowIndex: index,
          rowCount: rows.length,
        });
        return null;
      }

      return index;
    } catch (err) {
      this.logger?.error({
        msg: 'LLM header detection failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

// LAYER: Infrastructure
// LLMPort implementation using OpenAI SDK (gpt-4o).
// Default implementation — swappable with ClaudeAdapter without modifying
// any use case (ADR-002, dependency inversion principle).

import OpenAI from 'openai';
import { z } from 'zod';
import type { LLMPort, UserContext, ConversationContext } from '../../../domain/ports/services';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';

// Zod schema for LLM response — strict JSON output validation
const ExtractedExpenseSchema = z.object({
  monto: z.number().nullable(),
  moneda: z.enum(['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL']).nullable(),
  categoria_raw: z.string().nullable(),
  fecha_raw: z.string().nullable(),
  medio_pago: z.string().nullable(),
  confianza_categoria: z.enum(['alta', 'baja', 'nula']),
});

// Strict system prompt — structured extraction instructions (ADR-002)
function buildExtractionSystemPrompt(ctx: UserContext): string {
  return `Eres el motor de extracción de datos de Gastto. Tu ÚNICA tarea es:
1. Extraer las entidades del mensaje del usuario: monto, moneda, categoría, fecha y medio de pago.
2. Devolver un JSON estricto con el esquema definido. Sin markdown, sin explicaciones.
3. Nunca inventar datos. Si un campo no está presente, devolver null.

Moneda por defecto del usuario: ${ctx.defaultCurrency ?? 'desconocida'}.
Categorías disponibles en la planilla: ${ctx.categories.length > 0 ? ctx.categories.join(', ') : 'ninguna definida aún'}.

Esquema de salida (siempre JSON puro, sin backticks):
{
  "monto": number | null,
  "moneda": "ARS" | "EUR" | "USD" | "MXN" | "GBP" | "BRL" | null,
  "categoria_raw": string | null,
  "fecha_raw": string | null,
  "medio_pago": string | null,
  "confianza_categoria": "alta" | "baja" | "nula"
}

Reglas para confianza_categoria:
- "alta": la categoría coincide exactamente o es muy similar a una de las disponibles
- "baja": la categoría es inferida pero no coincide exactamente con ninguna disponible
- "nula": no se puede inferir ninguna categoría del mensaje`;
}

export class OpenAIAdapter implements LLMPort {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async extractExpense(userMessage: string, userContext: UserContext): Promise<ExtractedExpense> {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0, // maximum determinism for structured extraction
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildExtractionSystemPrompt(userContext) },
        { role: 'user', content: userMessage },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('LLM returned empty response');

    const parsed: unknown = JSON.parse(raw);
    const validated = ExtractedExpenseSchema.parse(parsed);

    return {
      monto: validated.monto,
      moneda: validated.moneda,
      categoriaRaw: validated.categoria_raw,
      fechaRaw: validated.fecha_raw,
      medioPago: validated.medio_pago,
      confianzaCategoria: validated.confianza_categoria,
    };
  }

  async generateResponse(prompt: string, _context: ConversationContext): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    return completion.choices[0]?.message?.content ?? '';
  }
}

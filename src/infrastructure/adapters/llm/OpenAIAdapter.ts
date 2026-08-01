// LAYER: Infrastructure
// LLMPort implementation using OpenAI SDK (gpt-4o).
// Default implementation — swappable with ClaudeAdapter without modifying
// any use case (ADR-002, dependency inversion principle).

import OpenAI from 'openai';
import { z } from 'zod';
import type {
  LLMPort,
  UserContext,
  ConversationContext,
  ExpenseCorrectionSuggestion,
} from '../../../domain/ports/services';
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

const ExpenseCorrectionSuggestionSchema = z.object({
  interpretable: z.boolean(),
  changed_fields: z.array(z.enum(['monto', 'moneda', 'categoria', 'fecha'])),
  monto: z.number().nullable(),
  moneda: z.enum(['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL']).nullable(),
  categoria_raw: z.string().nullable(),
  fecha_raw: z.string().nullable(),
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

function buildCorrectionSystemPrompt(ctx: UserContext, currentExtracted: ExtractedExpense): string {
  const currentSummary = formatExtractedExpense(currentExtracted);

  return `Eres el motor de corrección de Gastto. El usuario acaba de ver un resumen de gasto y responde en lenguaje natural para corregir uno o varios campos.

Resumen actual:
${currentSummary}

Categorías disponibles en la planilla: ${ctx.categories.length > 0 ? ctx.categories.join(', ') : 'ninguna definida aún'}.
Moneda por defecto del usuario: ${ctx.defaultCurrency ?? 'desconocida'}.

Tu tarea:
1. Identificar qué campos del resumen corrige el mensaje del usuario.
2. Extraer los nuevos valores solo para esos campos.
3. Devolver un JSON estricto con el esquema definido. Sin markdown, sin explicaciones.
4. Si el mensaje no corrige ningún campo (por ejemplo "uh-huh", "confirmo", "cancelar"), devolver interpretable: false y todos los valores null.
5. Nunca inventar datos. Si un campo no se corrige, devolver null.

Campos corregibles: monto, moneda, categoria, fecha.

Ejemplos válidos:
- "no, fueron 15" → changed_fields: ["monto"], monto: 15
- "ponlo en transporte" → changed_fields: ["categoria"], categoria_raw: "transporte"
- "fue ayer" → changed_fields: ["fecha"], fecha_raw: "ayer"
- "no, fueron 15 y es transporte" → changed_fields: ["monto", "categoria"], monto: 15, categoria_raw: "transporte"

Esquema de salida (siempre JSON puro, sin backticks):
{
  "interpretable": boolean,
  "changed_fields": ["monto" | "moneda" | "categoria" | "fecha"],
  "monto": number | null,
  "moneda": "ARS" | "EUR" | "USD" | "MXN" | "GBP" | "BRL" | null,
  "categoria_raw": string | null,
  "fecha_raw": string | null
}`;
}

function formatExtractedExpense(extracted: ExtractedExpense): string {
  return [
    `Monto: ${extracted.monto ?? 'no especificado'} ${extracted.moneda ?? ''}`,
    `Categoría: ${extracted.categoriaRaw ?? 'no especificada'}`,
    `Fecha: ${extracted.fechaRaw ?? 'no especificada'}`,
    `Medio de pago: ${extracted.medioPago ?? 'no especificado'}`,
  ].join('\n');
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

  async interpretCorrection(
    rawMessage: string,
    currentExtracted: ExtractedExpense,
    userContext: UserContext,
  ): Promise<ExpenseCorrectionSuggestion> {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: buildCorrectionSystemPrompt(userContext, currentExtracted),
        },
        { role: 'user', content: rawMessage },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('LLM returned empty response');

    const parsed: unknown = JSON.parse(raw);
    const validated = ExpenseCorrectionSuggestionSchema.parse(parsed);

    return {
      interpretable: validated.interpretable,
      changedFields: validated.changed_fields,
      monto: validated.monto,
      moneda: validated.moneda,
      categoriaRaw: validated.categoria_raw,
      fechaRaw: validated.fecha_raw,
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

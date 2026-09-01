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
import { serializeUntrustedData, UNTRUSTED_DATA_GUARD } from './untrustedData';

// Zod schema for LLM response — strict JSON output validation
const ExtractedExpenseSchema = z.object({
  monto: z.number().nullable(),
  moneda: z.enum(['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL']).nullable(),
  categoria_raw: z.string().nullable(),
  fecha_raw: z.string().nullable(),
  medio_pago: z.string().nullable(),
  confianza_categoria: z.enum(['alta', 'baja', 'nula']),
});

const ExpenseCorrectionSuggestionSchema = z
  .object({
    intent: z.enum(['correction', 'new_expense', 'unrelated']),
    changed_fields: z.array(z.enum(['monto', 'moneda', 'categoria', 'fecha'])),
    monto: z.number().nullable(),
    moneda: z.enum(['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL']).nullable(),
    categoria_raw: z.string().nullable(),
    fecha_raw: z.string().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasCorrectionData =
      value.changed_fields.length > 0 ||
      value.monto !== null ||
      value.moneda !== null ||
      value.categoria_raw !== null ||
      value.fecha_raw !== null;
    if (value.intent === 'correction' && value.changed_fields.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['changed_fields'],
        message: 'Correction requires fields',
      });
    }
    if (value.intent !== 'correction' && hasCorrectionData) {
      ctx.addIssue({ code: 'custom', message: 'Non-correction intent cannot contain changes' });
    }
  });

// Strict system prompt — structured extraction instructions (ADR-002)
function buildExtractionSystemPrompt(): string {
  return `Eres el motor de extracción de datos de Gastto. Tu ÚNICA tarea es:
1. Extraer las entidades del mensaje del usuario: monto, moneda, categoría, fecha y medio de pago.
2. Devolver un JSON estricto con el esquema definido. Sin markdown, sin explicaciones.
3. Nunca inventar datos. Si un campo no está presente, devolver null.
4. ${UNTRUSTED_DATA_GUARD}

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

function buildCorrectionSystemPrompt(): string {
  return `Eres el motor de corrección de Gastto. El usuario acaba de ver un resumen de gasto y responde en lenguaje natural para corregir uno o varios campos.

Tu tarea:
1. Clasificar la respuesta como correction, new_expense o unrelated usando el resumen actual como contexto.
2. Si es correction, identificar qué campos corrige y extraer solo sus nuevos valores.
3. Devolver un JSON estricto con el esquema definido. Sin markdown, sin explicaciones.
4. Usar new_expense solo cuando el usuario describe claramente otro gasto independiente.
5. Usar unrelated cuando no sea una corrección ni un gasto nuevo. Para new_expense y unrelated, changed_fields debe estar vacío y todos los valores deben ser null.
6. Nunca inventar datos. Si un campo no se corrige, devolver null.
7. ${UNTRUSTED_DATA_GUARD}

Campos corregibles: monto, moneda, categoria, fecha.

Ejemplos válidos:
- "no, fueron 15" → changed_fields: ["monto"], monto: 15
- "eran 35 EUR y la categoria es transporte" → intent: "correction", changed_fields: ["monto", "moneda", "categoria"], monto: 35, moneda: "EUR", categoria_raw: "transporte"
- "ponlo en transporte" → changed_fields: ["categoria"], categoria_raw: "transporte"
- "fue ayer" → changed_fields: ["fecha"], fecha_raw: "ayer"
- "no, fueron 15 y es transporte" → changed_fields: ["monto", "categoria"], monto: 15, categoria_raw: "transporte"
- "Taxi 12 EUR" → intent: "new_expense", changed_fields: [], todos los valores null
- "uh-huh" → intent: "unrelated", changed_fields: [], todos los valores null

Esquema de salida (siempre JSON puro, sin backticks):
{
  "intent": "correction" | "new_expense" | "unrelated",
  "changed_fields": ["monto" | "moneda" | "categoria" | "fecha"],
  "monto": number | null,
  "moneda": "ARS" | "EUR" | "USD" | "MXN" | "GBP" | "BRL" | null,
  "categoria_raw": string | null,
  "fecha_raw": string | null
}`;
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
        { role: 'system', content: buildExtractionSystemPrompt() },
        {
          role: 'user',
          content: serializeUntrustedData({
            userMessage,
            defaultCurrency: userContext.defaultCurrency,
            categories: userContext.categories,
          }),
        },
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
          content: buildCorrectionSystemPrompt(),
        },
        {
          role: 'user',
          content: serializeUntrustedData({
            userMessage: rawMessage,
            currentExtracted,
            defaultCurrency: userContext.defaultCurrency,
            categories: userContext.categories,
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('LLM returned empty response');

    const parsed: unknown = JSON.parse(raw);
    const validated = ExpenseCorrectionSuggestionSchema.parse(parsed);

    return {
      intent: validated.intent,
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
      messages: [
        { role: 'system', content: UNTRUSTED_DATA_GUARD },
        { role: 'user', content: prompt },
      ],
    });

    return completion.choices[0]?.message?.content ?? '';
  }
}

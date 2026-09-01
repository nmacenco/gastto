// LAYER: Infrastructure
// Alternative LLMPort implementation using Anthropic SDK (claude-sonnet-4-6).
// Swappable with OpenAIAdapter without modifying any use case (ADR-002).

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type {
  LLMPort,
  UserContext,
  ConversationContext,
  ExpenseCorrectionSuggestion,
} from '../../../domain/ports/services';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import { serializeUntrustedData, UNTRUSTED_DATA_GUARD } from './untrustedData';

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

function buildExtractionSystemPrompt(): string {
  return `Eres el motor de extracción de datos de Gastto. Tu ÚNICA tarea es:
1. Extraer del mensaje del usuario: monto, moneda, categoría, fecha y medio de pago.
2. Devolver exclusivamente un JSON con el esquema definido. Sin markdown, sin texto adicional.
3. Nunca inventar datos. Si un campo no está presente, devolver null.
4. ${UNTRUSTED_DATA_GUARD}

Esquema de salida (JSON puro, sin backticks ni comentarios):
{
  "monto": number | null,
  "moneda": "ARS" | "EUR" | "USD" | "MXN" | "GBP" | "BRL" | null,
  "categoria_raw": string | null,
  "fecha_raw": string | null,
  "medio_pago": string | null,
  "confianza_categoria": "alta" | "baja" | "nula"
}`;
}

function buildCorrectionSystemPrompt(): string {
  return `Eres el motor de corrección de Gastto. El usuario acaba de ver un resumen de gasto y responde en lenguaje natural para corregir uno o varios campos.

Tu tarea:
1. Clasificar la respuesta como correction, new_expense o unrelated usando el resumen actual como contexto.
2. Si es correction, identificar qué campos corrige y extraer solo sus nuevos valores.
3. Devolver exclusivamente un JSON con el esquema definido. Sin markdown, sin texto adicional.
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

Esquema de salida (JSON puro, sin backticks ni comentarios):
{
  "intent": "correction" | "new_expense" | "unrelated",
  "changed_fields": ["monto" | "moneda" | "categoria" | "fecha"],
  "monto": number | null,
  "moneda": "ARS" | "EUR" | "USD" | "MXN" | "GBP" | "BRL" | null,
  "categoria_raw": string | null,
  "fecha_raw": string | null
}`;
}

export class ClaudeAdapter implements LLMPort {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extractExpense(userMessage: string, userContext: UserContext): Promise<ExtractedExpense> {
    const message = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: buildExtractionSystemPrompt(),
      messages: [
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

    const block = message.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('Claude returned no text block');

    // Defensively clean possible backticks even though the prompt forbids them
    const cleaned = block.text.replace(/```json|```/g, '').trim();
    const parsed: unknown = JSON.parse(cleaned);
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
    const message = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: buildCorrectionSystemPrompt(),
      messages: [
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

    const block = message.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('Claude returned no text block');

    const cleaned = block.text.replace(/```json|```/g, '').trim();
    const parsed: unknown = JSON.parse(cleaned);
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
    const message = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: UNTRUSTED_DATA_GUARD,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = message.content.find((b) => b.type === 'text');
    return block?.type === 'text' ? block.text : '';
  }
}

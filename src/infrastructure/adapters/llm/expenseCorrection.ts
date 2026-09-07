// LAYER: Infrastructure
// Shared correction schema, prompt, and provider response mapping.

import { z } from 'zod';
import type { ExpenseCorrectionSuggestion } from '../../../domain/ports/services';
import { UNTRUSTED_DATA_GUARD } from './untrustedData';

export const ExpenseCorrectionSuggestionSchema = z
  .object({
    intent: z.enum(['correction', 'new_expense', 'unrelated']),
    changed_fields: z.array(z.enum(['monto', 'moneda', 'categoria', 'subcategoria', 'fecha'])),
    monto: z.number().nullable(),
    moneda: z.enum(['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL']).nullable(),
    categoria_raw: z.string().nullable(),
    subcategoria_raw: z.string().nullable(),
    fecha_raw: z.string().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasCorrectionData =
      value.changed_fields.length > 0 ||
      value.monto !== null ||
      value.moneda !== null ||
      value.categoria_raw !== null ||
      value.subcategoria_raw !== null ||
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

type ExpenseCorrectionSuggestionResponse = z.infer<typeof ExpenseCorrectionSuggestionSchema>;

export function toExpenseCorrectionSuggestion(
  value: ExpenseCorrectionSuggestionResponse,
): ExpenseCorrectionSuggestion {
  return {
    intent: value.intent,
    changedFields: value.changed_fields,
    monto: value.monto,
    moneda: value.moneda,
    categoriaRaw: value.categoria_raw,
    subcategoriaRaw: value.subcategoria_raw,
    fechaRaw: value.fecha_raw,
  };
}

export function buildCorrectionSystemPrompt(): string {
  return `Eres el motor de corrección de Gastto. El usuario acaba de ver un resumen de gasto y responde en lenguaje natural para corregir uno o varios campos.

Tu tarea:
1. Clasificar la respuesta como correction, new_expense o unrelated usando el resumen actual como contexto.
2. Si es correction, identificar qué campos corrige y extraer solo sus nuevos valores.
3. Devolver exclusivamente un JSON estricto con el esquema definido. Sin markdown, sin explicaciones.
4. Distinguir categoria (padre) de subcategoria (hija). Una categoría puede quedar sin subcategoría.
5. El contexto jerárquico contiene las relaciones configuradas, pero la salida es solo una sugerencia: nunca inventes ni cambies una subcategoría de padre.
6. Usar new_expense solo cuando el usuario describe claramente otro gasto independiente.
7. Para new_expense y unrelated, changed_fields debe estar vacío y todos los valores deben ser null.
8. Si un campo no se corrige, devolver null.
9. ${UNTRUSTED_DATA_GUARD}

Campos corregibles: monto, moneda, categoria, subcategoria, fecha.

Ejemplos válidos:
- "no, fueron 15" → changed_fields: ["monto"], monto: 15
- "eran 35 EUR y la categoria es transporte" → intent: "correction", changed_fields: ["monto", "moneda", "categoria"], monto: 35, moneda: "EUR", categoria_raw: "transporte"
- "es Ocio, subcategoria Streaming" → changed_fields: ["categoria", "subcategoria"], categoria_raw: "Ocio", subcategoria_raw: "Streaming"
- "la subcategoria es Restaurante" → changed_fields: ["subcategoria"], subcategoria_raw: "Restaurante"
- "ponlo en transporte, sin subcategoria" → changed_fields: ["categoria"], categoria_raw: "transporte", subcategoria_raw: null
- "fue ayer" → changed_fields: ["fecha"], fecha_raw: "ayer"
- "Taxi 12 EUR" → intent: "new_expense", changed_fields: [], todos los valores null
- "uh-huh" → intent: "unrelated", changed_fields: [], todos los valores null

Esquema de salida (siempre JSON puro, sin backticks):
{
  "intent": "correction" | "new_expense" | "unrelated",
  "changed_fields": ["monto" | "moneda" | "categoria" | "subcategoria" | "fecha"],
  "monto": number | null,
  "moneda": "ARS" | "EUR" | "USD" | "MXN" | "GBP" | "BRL" | null,
  "categoria_raw": string | null,
  "subcategoria_raw": string | null,
  "fecha_raw": string | null
}`;
}

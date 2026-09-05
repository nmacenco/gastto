// LAYER: Infrastructure
// Shared structured-expense extraction contract used by every LLM provider.

import { z } from 'zod';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import { UNTRUSTED_DATA_GUARD } from './untrustedData';

export const ExtractedExpenseSchema = z
  .object({
    monto: z.number().nullable(),
    moneda: z.enum(['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL']).nullable(),
    categoria_raw: z.string().nullable(),
    subcategoria_raw: z.string().nullable(),
    fecha_raw: z.string().nullable(),
    medio_pago: z.string().nullable(),
    confianza_categoria: z.enum(['alta', 'baja', 'nula']),
    confianza_subcategoria: z.enum(['alta', 'baja', 'nula']),
  })
  .strict();

export type ExtractedExpenseResponse = z.infer<typeof ExtractedExpenseSchema>;

export function toExtractedExpense(response: ExtractedExpenseResponse): ExtractedExpense {
  return {
    monto: response.monto,
    moneda: response.moneda,
    categoriaRaw: response.categoria_raw,
    subcategoriaRaw: response.subcategoria_raw,
    fechaRaw: response.fecha_raw,
    medioPago: response.medio_pago,
    confianzaCategoria: response.confianza_categoria,
    confianzaSubcategoria: response.confianza_subcategoria,
  };
}

export function buildExtractionSystemPrompt(): string {
  return `Eres el motor de extracción de datos de Gastto. Tu ÚNICA tarea es:
1. Extraer las entidades del mensaje del usuario: monto, moneda, categoría, subcategoría, fecha y medio de pago.
2. Devolver un JSON estricto con todas las claves del esquema. Sin markdown ni explicaciones.
3. Nunca inventar datos. Si la categoría o subcategoría no está presente, devolver null y confianza "nula" para ese nivel.
4. Evaluar la confianza de categoría y subcategoría de forma independiente.
5. categoryHierarchy contiene las relaciones disponibles. Una categoría válida puede no tener subcategoría.
6. Si subcategoryEnabled es false, devolver subcategoria_raw: null y confianza_subcategoria: "nula".
7. No inventar relaciones ni trasladar una subcategoría a otro padre. Si un nombre existe bajo varios padres, usar únicamente el contexto explícito del mensaje.
8. ${UNTRUSTED_DATA_GUARD}

Esquema de salida (siempre JSON puro, sin backticks):
{
  "monto": number | null,
  "moneda": "ARS" | "EUR" | "USD" | "MXN" | "GBP" | "BRL" | null,
  "categoria_raw": string | null,
  "subcategoria_raw": string | null,
  "fecha_raw": string | null,
  "medio_pago": string | null,
  "confianza_categoria": "alta" | "baja" | "nula",
  "confianza_subcategoria": "alta" | "baja" | "nula"
}`;
}

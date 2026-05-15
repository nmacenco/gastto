// LAYER: Infrastructure
// Alternative LLMPort implementation using Anthropic SDK (claude-sonnet-4-6).
// Swappable with OpenAIAdapter without modifying any use case (ADR-002).

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  LLMPort,
  UserContext,
  ConversationContext,
} from "../../../domain/ports/services";
import type { ExtractedExpense } from "../../../domain/entities/ExpenseRecord";

const ExtractedExpenseSchema = z.object({
  monto: z.number().nullable(),
  moneda: z.enum(["ARS", "EUR", "USD", "MXN", "GBP", "BRL"]).nullable(),
  categoria_raw: z.string().nullable(),
  fecha_raw: z.string().nullable(),
  medio_pago: z.string().nullable(),
  confianza_categoria: z.enum(["alta", "baja", "nula"]),
});

function buildExtractionSystemPrompt(ctx: UserContext): string {
  return `Eres el motor de extracción de datos de Gastto. Tu ÚNICA tarea es:
1. Extraer del mensaje del usuario: monto, moneda, categoría, fecha y medio de pago.
2. Devolver exclusivamente un JSON con el esquema definido. Sin markdown, sin texto adicional.
3. Nunca inventar datos. Si un campo no está presente, devolver null.

Moneda por defecto del usuario: ${ctx.defaultCurrency ?? "desconocida"}.
Categorías disponibles en la planilla: ${ctx.categories.length > 0 ? ctx.categories.join(", ") : "ninguna definida aún"}.

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

export class ClaudeAdapter implements LLMPort {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extractExpense(
    userMessage: string,
    userContext: UserContext,
  ): Promise<ExtractedExpense> {
    const message = await this.client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: buildExtractionSystemPrompt(userContext),
      messages: [{ role: "user", content: userMessage }],
    });

    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text")
      throw new Error("Claude returned no text block");

    // Defensively clean possible backticks even though the prompt forbids them
    const cleaned = block.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
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

  async generateResponse(
    prompt: string,
    _context: ConversationContext,
  ): Promise<string> {
    const message = await this.client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content.find((b) => b.type === "text");
    return block?.type === "text" ? block.text : "";
  }
}

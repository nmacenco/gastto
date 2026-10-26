// LAYER: Infrastructure
// Groq Chat Completions adapter with an independent credential.

import OpenAI from 'openai';
import type { Fetch } from 'openai/core';
import type {
  LLMPort,
  ExtractionExecutionOptions,
  UserContext,
  ConversationContext,
  ExpenseCorrectionSuggestion,
} from '../../../domain/ports/services';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import { serializeUntrustedData, UNTRUSTED_DATA_GUARD } from './untrustedData';
import { buildExtractionSystemPrompt } from './expenseExtraction';
import { runExtraction, type ExtractionSettings } from './extractionRuntime';
import {
  buildCorrectionSystemPrompt,
  ExpenseCorrectionSuggestionSchema,
  toExpenseCorrectionSuggestion,
} from './expenseCorrection';

// GPT-OSS supports constrained decoding. Keep every field required and nullable
// where the shared extraction contract permits an unknown value.
const STRICT_EXPENSE_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'gastto_expense',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        monto: { type: ['number', 'null'] },
        moneda: {
          type: ['string', 'null'],
          enum: ['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL', null],
        },
        categoria_raw: { type: ['string', 'null'] },
        subcategoria_raw: { type: ['string', 'null'] },
        fecha_raw: { type: ['string', 'null'] },
        medio_pago: { type: ['string', 'null'] },
        confianza_categoria: { type: 'string', enum: ['alta', 'baja', 'nula'] },
        confianza_subcategoria: { type: 'string', enum: ['alta', 'baja', 'nula'] },
      },
      required: [
        'monto',
        'moneda',
        'categoria_raw',
        'subcategoria_raw',
        'fecha_raw',
        'medio_pago',
        'confianza_categoria',
        'confianza_subcategoria',
      ],
      additionalProperties: false,
    },
  },
};

export class GroqAdapter implements LLMPort {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model = 'openai/gpt-oss-20b',
    private readonly extractionSettings: ExtractionSettings = {},
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
      maxRetries: 0,
      fetch: globalThis.fetch as unknown as Fetch,
    });
  }

  async extractExpense(
    userMessage: string,
    userContext: UserContext,
    options?: ExtractionExecutionOptions,
  ): Promise<ExtractedExpense> {
    return runExtraction('groq', this.model, this.extractionSettings, options, async (signal) => {
      const strictModel =
        this.model === 'openai/gpt-oss-20b' || this.model === 'openai/gpt-oss-120b';
      const completion = await this.client.chat.completions.create(
        {
          model: this.model,
          temperature: 0,
          max_completion_tokens: strictModel ? 1024 : 512,
          ...(strictModel ? { reasoning_effort: 'low' as const } : {}),
          response_format: strictModel ? STRICT_EXPENSE_RESPONSE_FORMAT : { type: 'json_object' },
          messages: [
            { role: 'system', content: buildExtractionSystemPrompt() },
            {
              role: 'user',
              content: serializeUntrustedData({
                userMessage,
                defaultCurrency: userContext.defaultCurrency,
                categories: userContext.categories,
                categoryHierarchy: userContext.categoryHierarchy,
                subcategoryEnabled: userContext.subcategoryEnabled,
                paymentMethods: userContext.paymentMethods ?? [],
                paymentCatalogConfigured: userContext.paymentCatalogConfigured ?? false,
              }),
            },
          ],
        },
        {
          signal,
          maxRetries: 0,
          timeout: options?.timeoutMs ?? this.extractionSettings.timeoutMs ?? 30_000,
        },
      );

      return {
        content: completion.choices?.[0]?.message?.content,
        finishReason: completion.choices?.[0]?.finish_reason,
        inputTokens: completion.usage?.prompt_tokens,
        outputTokens: completion.usage?.completion_tokens,
      };
    });
  }

  async interpretCorrection(
    rawMessage: string,
    currentExtracted: ExtractedExpense,
    userContext: UserContext,
  ): Promise<ExpenseCorrectionSuggestion> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      max_completion_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildCorrectionSystemPrompt() },
        {
          role: 'user',
          content: serializeUntrustedData({
            userMessage: rawMessage,
            currentExtracted,
            defaultCurrency: userContext.defaultCurrency,
            categories: userContext.categories,
            categoryHierarchy: userContext.categoryHierarchy,
            subcategoryEnabled: userContext.subcategoryEnabled,
            paymentMethods: userContext.paymentMethods ?? [],
            paymentCatalogConfigured: userContext.paymentCatalogConfigured ?? false,
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('LLM returned empty response');
    const parsed: unknown = JSON.parse(raw);
    return toExpenseCorrectionSuggestion(ExpenseCorrectionSuggestionSchema.parse(parsed));
  }

  async generateResponse(prompt: string, _context: ConversationContext): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.3,
      max_completion_tokens: 1024,
      messages: [
        { role: 'system', content: UNTRUSTED_DATA_GUARD },
        { role: 'user', content: prompt },
      ],
    });
    return completion.choices[0]?.message?.content ?? '';
  }
}

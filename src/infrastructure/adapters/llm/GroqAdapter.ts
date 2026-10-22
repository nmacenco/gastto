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
      const completion = await this.client.chat.completions.create(
        {
          model: this.model,
          temperature: 0,
          max_completion_tokens: 512,
          response_format: { type: 'json_object' },
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

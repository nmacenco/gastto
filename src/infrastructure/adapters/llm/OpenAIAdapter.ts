// LAYER: Infrastructure
// LLMPort implementation using OpenAI SDK (gpt-4o).
// Default implementation — swappable with ClaudeAdapter without modifying
// any use case (ADR-002, dependency inversion principle).

import OpenAI from 'openai';
import type {
  LLMPort,
  UserContext,
  ConversationContext,
  ExpenseCorrectionSuggestion,
} from '../../../domain/ports/services';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import { serializeUntrustedData, UNTRUSTED_DATA_GUARD } from './untrustedData';
import {
  buildExtractionSystemPrompt,
  ExtractedExpenseSchema,
  toExtractedExpense,
} from './expenseExtraction';
import {
  buildCorrectionSystemPrompt,
  ExpenseCorrectionSuggestionSchema,
  toExpenseCorrectionSuggestion,
} from './expenseCorrection';

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
            categoryHierarchy: userContext.categoryHierarchy,
            subcategoryEnabled: userContext.subcategoryEnabled,
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('LLM returned empty response');

    const parsed: unknown = JSON.parse(raw);
    const validated = ExtractedExpenseSchema.parse(parsed);

    return toExtractedExpense(validated);
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
            categoryHierarchy: userContext.categoryHierarchy,
            subcategoryEnabled: userContext.subcategoryEnabled,
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('LLM returned empty response');

    const parsed: unknown = JSON.parse(raw);
    const validated = ExpenseCorrectionSuggestionSchema.parse(parsed);

    return toExpenseCorrectionSuggestion(validated);
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

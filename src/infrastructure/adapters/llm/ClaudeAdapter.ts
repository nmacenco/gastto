// LAYER: Infrastructure
// Alternative LLMPort implementation using Anthropic SDK (claude-sonnet-4-6).
// Swappable with OpenAIAdapter without modifying any use case (ADR-002).

import Anthropic from '@anthropic-ai/sdk';
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
            categoryHierarchy: userContext.categoryHierarchy,
            subcategoryEnabled: userContext.subcategoryEnabled,
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

    return toExtractedExpense(validated);
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
            categoryHierarchy: userContext.categoryHierarchy,
            subcategoryEnabled: userContext.subcategoryEnabled,
          }),
        },
      ],
    });

    const block = message.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('Claude returned no text block');

    const cleaned = block.text.replace(/```json|```/g, '').trim();
    const parsed: unknown = JSON.parse(cleaned);
    const validated = ExpenseCorrectionSuggestionSchema.parse(parsed);

    return toExpenseCorrectionSuggestion(validated);
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

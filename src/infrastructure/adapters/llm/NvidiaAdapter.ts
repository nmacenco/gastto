// LAYER: Infrastructure
// LLMPort implementation using the NVIDIA API (OpenAI-compatible endpoint).
// Swappable with OpenAIAdapter and ClaudeAdapter without modifying any use case
// (ADR-002, dependency inversion principle).

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

// Minimal type for the NVIDIA OpenAI-compatible chat completion response.
// The endpoint returns the same shape as OpenAI's /v1/chat/completions.
type NvidiaChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

export class NvidiaAdapter implements LLMPort {
  private readonly apiKey: string;
  private readonly invokeUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';
  private readonly model = 'minimaxai/minimax-m3';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async extractExpense(userMessage: string, userContext: UserContext): Promise<ExtractedExpense> {
    const response = await fetch(this.invokeUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0, // maximum determinism for structured extraction
        top_p: 0.95,
        max_tokens: 512,
        stream: false,
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
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`NVIDIA API error ${response.status}: ${text}`);
    }

    const data: unknown = await response.json();
    const raw = this.extractContent(data);
    if (!raw) throw new Error('LLM returned empty response');

    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed: unknown = JSON.parse(cleaned);
    const validated = ExtractedExpenseSchema.parse(parsed);

    return toExtractedExpense(validated);
  }

  async interpretCorrection(
    rawMessage: string,
    currentExtracted: ExtractedExpense,
    userContext: UserContext,
  ): Promise<ExpenseCorrectionSuggestion> {
    const response = await fetch(this.invokeUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        top_p: 0.95,
        max_tokens: 512,
        stream: false,
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
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`NVIDIA API error ${response.status}: ${text}`);
    }

    const data: unknown = await response.json();
    const raw = this.extractContent(data);
    if (!raw) throw new Error('LLM returned empty response');

    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed: unknown = JSON.parse(cleaned);
    const validated = ExpenseCorrectionSuggestionSchema.parse(parsed);

    return toExpenseCorrectionSuggestion(validated);
  }

  async generateResponse(prompt: string, _context: ConversationContext): Promise<string> {
    const response = await fetch(this.invokeUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        top_p: 0.95,
        max_tokens: 1024,
        stream: false,
        messages: [
          { role: 'system', content: UNTRUSTED_DATA_GUARD },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`NVIDIA API error ${response.status}: ${text}`);
    }

    const data: unknown = await response.json();
    return this.extractContent(data) ?? '';
  }

  private extractContent(data: unknown): string | undefined {
    const parsed = data as NvidiaChatResponse;
    const content = parsed.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : undefined;
  }
}

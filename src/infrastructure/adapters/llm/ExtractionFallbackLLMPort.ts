// LAYER: Infrastructure
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import { LLMExtractionError } from '../../../domain/errors/LLMExtractionError';
import type {
  ConversationContext,
  ExpenseCorrectionSuggestion,
  ExtractionExecutionOptions,
  LLMPort,
  UserContext,
} from '../../../domain/ports/services';

export type ExtractionProvider = 'nvidia' | 'anthropic' | 'openai';

/** Try one independent provider after a failed extraction, within one deadline. */
export class ExtractionFallbackLLMPort implements LLMPort {
  constructor(
    private readonly primary: LLMPort,
    private readonly fallback: LLMPort,
    private readonly primaryProvider: ExtractionProvider,
    private readonly fallbackProvider: ExtractionProvider,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 2 || timeoutMs > 60_000) {
      throw new Error('Invalid extraction fallback timeout');
    }
    if (primaryProvider === fallbackProvider) {
      throw new Error('Extraction fallback must use a different provider');
    }
  }

  async extractExpense(
    userMessage: string,
    userContext: UserContext,
    options?: ExtractionExecutionOptions,
  ): Promise<ExtractedExpense> {
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 2 || timeoutMs > 60_000) {
      throw new Error('Invalid extraction fallback timeout');
    }
    const correlationId = options?.correlationId ?? randomUUID();
    const deadline = Date.now() + timeoutMs;
    try {
      return await this.primary.extractExpense(userMessage, userContext, {
        ...options,
        correlationId,
        timeoutMs: Math.floor(timeoutMs / 2),
      });
    } catch (error) {
      if (
        !(error instanceof LLMExtractionError) ||
        error.code === 'LLM_CANCELLED' ||
        options?.signal?.aborted
      ) {
        throw error;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs < 1) throw new LLMExtractionError('LLM_TIMEOUT');
      this.logger.warn({
        event: 'llm_extraction_fallback_started',
        operation: 'extract_expense',
        correlationId,
        provider: this.primaryProvider,
        fallbackProvider: this.fallbackProvider,
        code: error.code,
        remainingMs,
      });
      return this.fallback.extractExpense(userMessage, userContext, {
        ...options,
        correlationId,
        timeoutMs: remainingMs,
      });
    }
  }

  interpretCorrection(
    rawMessage: string,
    currentExtracted: ExtractedExpense,
    userContext: UserContext,
  ): Promise<ExpenseCorrectionSuggestion> {
    return this.primary.interpretCorrection(rawMessage, currentExtracted, userContext);
  }

  generateResponse(prompt: string, context: ConversationContext): Promise<string> {
    return this.primary.generateResponse(prompt, context);
  }
}

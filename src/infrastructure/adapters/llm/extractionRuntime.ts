// LAYER: Infrastructure
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { ExtractionExecutionOptions } from '../../../domain/ports/services';
import { LLMExtractionError } from '../../../domain/errors/LLMExtractionError';
import { ExtractedExpenseSchema, toExtractedExpense } from './expenseExtraction';

export interface ExtractionSettings {
  timeoutMs?: number;
  logger?: Logger;
}

export interface ExtractionResponse {
  content: unknown;
  finishReason?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
}

export interface ExtractionMetadata {
  httpStatus?: number;
  requestBytes?: number;
  phase?: 'awaiting_headers' | 'reading_body' | 'processing_response';
}

/** Explicit allowlist: provider strings and exceptions can contain private data. */
function safeResponseMetadata(response: ExtractionResponse): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (typeof response.finishReason === 'string') {
    metadata['finishReason'] = [
      'stop',
      'length',
      'max_tokens',
      'end_turn',
      'stop_sequence',
      'tool_calls',
      'content_filter',
      'refusal',
      'pause_turn',
    ].includes(response.finishReason)
      ? response.finishReason
      : 'unknown';
  }
  for (const key of ['inputTokens', 'outputTokens'] as const) {
    const value = response[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
      metadata[key] = value;
  }
  return metadata;
}

export async function runExtraction(
  provider: 'nvidia' | 'openai' | 'anthropic',
  model: string,
  settings: ExtractionSettings,
  options: ExtractionExecutionOptions | undefined,
  request: (signal: AbortSignal, metadata: ExtractionMetadata) => Promise<ExtractionResponse>,
) {
  const timeoutMs = settings.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('Invalid extraction timeout');
  }
  const started = Date.now();
  const base = {
    provider,
    model,
    operation: 'extract_expense',
    correlationId: options?.correlationId ?? randomUUID(),
  };
  const controller = new AbortController();
  const metadata: ExtractionMetadata = {};
  let responseMetadata: Record<string, unknown> = {};
  let timedOut = false;
  const cancel = () => controller.abort();
  options?.signal?.addEventListener('abort', cancel, { once: true });
  if (options?.signal?.aborted) cancel();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortError = () => new LLMExtractionError(timedOut ? 'LLM_TIMEOUT' : 'LLM_CANCELLED');
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  settings.logger?.info({ ...base, event: 'llm_extraction_started', timeoutMs });
  try {
    if (controller.signal.aborted) throw abortError();
    // Race bounds non-cooperative transports too; the same signal aborts real I/O.
    const response = await Promise.race([request(controller.signal, metadata), aborted]);
    if (controller.signal.aborted) throw abortError();
    responseMetadata = safeResponseMetadata(response);
    if (response.finishReason === 'length' || response.finishReason === 'max_tokens') {
      throw new LLMExtractionError('LLM_OUTPUT_TRUNCATED');
    }
    if (typeof response.content !== 'string' || response.content.trim() === '') {
      throw new LLMExtractionError('LLM_EMPTY_RESPONSE');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.content.replace(/```json|```/g, '').trim());
    } catch {
      throw new LLMExtractionError('LLM_INVALID_JSON');
    }
    const validated = ExtractedExpenseSchema.safeParse(parsed);
    if (!validated.success) throw new LLMExtractionError('LLM_INVALID_SCHEMA');
    settings.logger?.info({
      ...base,
      ...metadata,
      ...responseMetadata,
      event: 'llm_extraction_completed',
      durationMs: Date.now() - started,
      timeoutMs,
      outcome: 'success',
    });
    return toExtractedExpense(validated.data);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number' &&
      Number.isInteger(error.status) &&
      error.status >= 100 &&
      error.status <= 599
    )
      metadata.httpStatus = error.status;
    const failure = controller.signal.aborted
      ? abortError()
      : error instanceof LLMExtractionError
        ? error
        : error instanceof Error && error.name === 'APIConnectionTimeoutError'
          ? new LLMExtractionError('LLM_TIMEOUT')
          : new LLMExtractionError('LLM_PROVIDER_ERROR');
    settings.logger?.error({
      ...base,
      ...metadata,
      ...responseMetadata,
      event: 'llm_extraction_completed',
      msg: 'Expense extraction failed',
      endpoint: 'extractExpense',
      durationMs: Date.now() - started,
      timeoutMs,
      outcome: 'failure',
      code: failure.code,
    });
    throw failure;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

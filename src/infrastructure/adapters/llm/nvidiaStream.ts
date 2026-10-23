import type { ExtractionMetadata, ExtractionResponse } from './extractionRuntime';

type NvidiaStreamChunk = {
  choices?: Array<{
    delta?: { content?: unknown; reasoning_content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

const MAX_EVENT_LENGTH = 64 * 1024;
const MAX_CONTENT_LENGTH = 64 * 1024;

/** Consume NVIDIA's OpenAI-compatible SSE response without retaining reasoning text. */
export async function readNvidiaStream(
  response: Response,
  metadata: ExtractionMetadata,
  requestStarted: number,
): Promise<ExtractionResponse> {
  if (!response.body) throw new Error('Provider stream has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let eventData: string[] = [];
  let content = '';
  let finishReason: unknown;
  let inputTokens: unknown;
  let outputTokens: unknown;
  let completed = false;

  const consumeEvent = () => {
    const data = eventData.join('\n').trim();
    eventData = [];
    if (data === '') return;
    if (data === '[DONE]') {
      completed = true;
      return;
    }
    const chunk = JSON.parse(data) as NvidiaStreamChunk;
    metadata.streamEvents = (metadata.streamEvents ?? 0) + 1;
    metadata.firstEventMs ??= Date.now() - requestStarted;
    const choice = chunk.choices?.[0];
    if (typeof choice?.delta?.reasoning_content === 'string' && choice.delta.reasoning_content) {
      metadata.reasoningEvents = (metadata.reasoningEvents ?? 0) + 1;
    }
    if (typeof choice?.delta?.content === 'string') {
      content += choice.delta.content;
      if (content.length > MAX_CONTENT_LENGTH) throw new Error('Provider content exceeds limit');
    }
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens;
      outputTokens = chunk.usage.completion_tokens;
    }
  };

  const consumeLine = (line: string) => {
    if (line === '') consumeEvent();
    else if (line.startsWith('data:')) {
      eventData.push(line.slice(5).trimStart());
      if (eventData.join('\n').length > MAX_EVENT_LENGTH)
        throw new Error('Provider event exceeds limit');
    }
  };

  try {
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) {
        pending += decoder.decode();
        if (pending) consumeLine(pending.replace(/\r$/, ''));
        consumeEvent();
        break;
      }
      pending += decoder.decode(value, { stream: true });
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, '');
        pending = pending.slice(newline + 1);
        consumeLine(line);
        if (completed) break;
        newline = pending.indexOf('\n');
      }
      if (pending.length > MAX_EVENT_LENGTH) throw new Error('Provider event exceeds limit');
    }
    if (!completed) throw new Error('Provider stream ended without completion');
    return { content, finishReason, inputTokens, outputTokens };
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

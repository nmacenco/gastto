// LAYER: Infrastructure
// Telegram Bot API adapter.
// Implements IChatMessenger (application port) and MessagingOutputPort (application output port).
// Includes exponential backoff retry for 5xx errors and automatic message chunking.

import type { IChatMessenger } from '../../../application/ports/IChatMessenger';
import type {
  MessagingOutputPort,
  SendResult,
} from '../../../application/ports/output/messaging.port';

const MAX_TEXT_LENGTH = 4096;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const fragments: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      fragments.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf('. ', maxLength);
    }
    if (splitIndex <= 0) {
      splitIndex = maxLength;
    } else {
      const twoChars = remaining.substring(splitIndex, splitIndex + 2);
      if (twoChars === '\n\n' || twoChars === '. ') {
        splitIndex += 2;
      }
    }

    fragments.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex);
  }

  return fragments;
}

export class TelegramMessengerAdapter implements IChatMessenger, MessagingOutputPort {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendWelcome(chatId: string, username?: string): Promise<void> {
    const text = username
      ? `¡Hola, ${username}! Bienvenido a Gastto. Soy tu asistente financiero conversacional. Escribime un gasto y lo registro en tu planilla automáticamente.`
      : '¡Hola! Bienvenido a Gastto. Soy tu asistente financiero conversacional. Escribime un gasto y lo registro en tu planilla automáticamente.';

    await this.sendMessage(chatId, text);
  }

  async sendMessage(chatId: string, text: string): Promise<SendResult> {
    const fragments = chunkText(text, MAX_TEXT_LENGTH);

    if (fragments.length > 1) {
      console.log({
        event: 'message_chunked',
        chatId,
        originalLength: text.length,
        fragmentCount: fragments.length,
      });
    }

    for (const fragment of fragments) {
      const result = await this.sendSingleMessage(chatId, fragment);
      if (result.status === 'failure') {
        return result;
      }
    }

    return { status: 'success' };
  }

  private async sendSingleMessage(chatId: string, text: string): Promise<SendResult> {
    const maxAttempts = RETRY_DELAYS_MS.length + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      });

      if (response.ok) {
        const json = (await response.json()) as { ok: boolean; description?: string };
        if (json.ok) {
          console.log({
            event: 'message_sent',
            chatId,
            textLength: text.length,
            attempt,
            result: 'success',
          });
          return { status: 'success' };
        }

        console.log({
          event: 'message_sent',
          chatId,
          textLength: text.length,
          attempt,
          result: 'failure',
          errorCode: 'TELEGRAM_API_ERROR',
        });
        return { status: 'failure', errorCode: 'TELEGRAM_API_ERROR' };
      }

      const status = response.status;

      if (status === 400 || status === 403) {
        console.error({
          event: 'message_send_failed',
          chatId,
          textLength: text.length,
          errorCode: 'PERMANENT_FAILURE',
          reason: `HTTP ${status}`,
        });
        return { status: 'failure', errorCode: 'PERMANENT_FAILURE' };
      }

      if (status >= 500 && attempt < maxAttempts) {
        console.log({
          event: 'retry_scheduled',
          chatId,
          textLength: text.length,
          attempt,
          delayMs: RETRY_DELAYS_MS[attempt - 1]!,
        });
        await sleep(RETRY_DELAYS_MS[attempt - 1]!);
        continue;
      }

      if (status >= 500) {
        console.log({
          event: 'message_sent',
          chatId,
          textLength: text.length,
          attempt,
          result: 'failure',
          errorCode: 'MAX_RETRIES_EXCEEDED',
        });
        return { status: 'failure', errorCode: 'MAX_RETRIES_EXCEEDED' };
      }

      console.log({
        event: 'message_sent',
        chatId,
        textLength: text.length,
        attempt,
        result: 'failure',
        errorCode: 'SEND_FAILED',
      });
      return { status: 'failure', errorCode: 'SEND_FAILED' };
    }

    console.log({
      event: 'message_sent',
      chatId,
      textLength: text.length,
      attempt: maxAttempts,
      result: 'failure',
      errorCode: 'MAX_RETRIES_EXCEEDED',
    });
    return { status: 'failure', errorCode: 'MAX_RETRIES_EXCEEDED' };
  }
}

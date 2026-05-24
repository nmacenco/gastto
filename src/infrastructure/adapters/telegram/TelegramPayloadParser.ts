// LAYER: Infrastructure
// Telegram payload parser adapter.
// Maps raw Telegram Update JSON to the domain NormalizedPayload contract.
// Never throws; always returns a NormalizedPayload so the route layer can
// respond 200 to Telegram without propagating exceptions.

import type { NormalizedPayload } from '../../../domain/ports/messaging';

/**
 * Validates whether a value is a non-null object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Checks whether the given payload looks like a Telegram Update with a message.
 */
function looksLikeTelegramUpdate(payload: unknown): payload is {
  message: {
    chat: { id: number | string };
    from?: { id: number | string } | undefined;
    text?: string | undefined;
    date: number;
  };
} {
  if (!isObject(payload)) {
    return false;
  }

  const message = payload.message;
  if (!isObject(message)) {
    return false;
  }

  const chat = message.chat;
  if (!isObject(chat)) {
    return false;
  }

  const chatId = chat.id;
  if (typeof chatId !== 'number' && typeof chatId !== 'string') {
    return false;
  }

  const date = message.date;
  if (typeof date !== 'number') {
    return false;
  }

  return true;
}

/**
 * Extracts userId from Telegram "from" field if present.
 */
function extractUserId(from: unknown): string | undefined {
  if (!isObject(from)) {
    return undefined;
  }
  const id = from.id;
  if (typeof id === 'number' || typeof id === 'string') {
    return String(id);
  }
  return undefined;
}

/**
 * Parses a raw Telegram webhook payload into a domain NormalizedPayload.
 *
 * Rules:
 *   - Valid text message  → messageType: 'TEXT'
 *   - Valid payload, no text (photo, audio, sticker, etc.) → messageType: 'UNSUPPORTED'
 *   - Anything else       → messageType: 'MALFORMED'
 */
export function parseTelegramPayload(payload: unknown): NormalizedPayload {
  if (!looksLikeTelegramUpdate(payload)) {
    return {
      messageType: 'MALFORMED',
      chatId: 'unknown',
      timestamp: new Date(),
      channel: 'telegram',
      rawPayload: payload,
    };
  }

  const { message } = payload;
  const chatId = String(message.chat.id);
  const userId = extractUserId(message.from);
  const timestamp = new Date(message.date * 1000);

  const text =
    typeof message.text === 'string' && message.text.trim().length > 0
      ? message.text.trim()
      : undefined;

  if (text === undefined) {
    return {
      messageType: 'UNSUPPORTED',
      chatId,
      userId,
      timestamp,
      channel: 'telegram',
    };
  }

  return {
    messageType: 'TEXT',
    chatId,
    userId,
    text,
    timestamp,
    channel: 'telegram',
  };
}

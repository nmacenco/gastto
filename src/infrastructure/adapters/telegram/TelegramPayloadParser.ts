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

type TelegramMessageLike = {
  message_id: number | string;
  chat: { id: number | string };
  from?: { id: number | string } | undefined;
  text?: string | undefined;
  date: number;
};

type TelegramCallbackQueryLike = {
  id: string;
  from: { id: number | string };
  message?: TelegramMessageLike | undefined;
  data?: string | undefined;
};

/**
 * Checks whether the given payload looks like a Telegram Update with a message.
 */
function looksLikeTelegramUpdate(payload: unknown): payload is {
  message: TelegramMessageLike;
} {
  if (!isObject(payload)) {
    return false;
  }

  const message = payload.message;
  if (!isObject(message)) {
    return false;
  }

  const messageId = message.message_id;
  if (typeof messageId !== 'number' && typeof messageId !== 'string') {
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
 * Checks whether the given payload looks like a Telegram Update with a callback query.
 */
function looksLikeTelegramCallbackQuery(payload: unknown): payload is {
  callback_query: TelegramCallbackQueryLike;
} {
  if (!isObject(payload)) {
    return false;
  }

  const callbackQuery = payload.callback_query;
  if (!isObject(callbackQuery)) {
    return false;
  }

  const id = callbackQuery.id;
  if (typeof id !== 'string') {
    return false;
  }

  const from = callbackQuery.from;
  if (!isObject(from)) {
    return false;
  }

  const fromId = from.id;
  if (typeof fromId !== 'number' && typeof fromId !== 'string') {
    return false;
  }

  const data = callbackQuery.data;
  if (typeof data !== 'string') {
    return false;
  }

  const message = callbackQuery.message;
  if (message !== undefined && !looksLikeTelegramMessage(message)) {
    return false;
  }

  return true;
}

function looksLikeTelegramMessage(message: unknown): message is TelegramMessageLike {
  if (!isObject(message)) {
    return false;
  }

  const messageId = message.message_id;
  if (typeof messageId !== 'number' && typeof messageId !== 'string') {
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

function parseCallbackData(
  data: string,
): { action: 'confirm' | 'correct' | 'cancel'; field?: string } | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!isObject(parsed) || typeof parsed.action !== 'string') {
      return null;
    }

    const action = parsed.action;
    if (action !== 'confirm' && action !== 'correct' && action !== 'cancel') {
      return null;
    }

    const result: { action: 'confirm' | 'correct' | 'cancel'; field?: string } = { action };
    if (typeof parsed.field === 'string') {
      result.field = parsed.field;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Parses a raw Telegram webhook payload into a domain NormalizedPayload.
 *
 * Rules:
 *   - Valid text message      → messageType: 'TEXT'
 *   - Valid callback query    → messageType: 'CALLBACK'
 *   - Valid payload, no text or unknown callback data → messageType: 'UNSUPPORTED'
 *   - Anything else           → messageType: 'MALFORMED'
 */
export function parseTelegramPayload(payload: unknown): NormalizedPayload {
  if (looksLikeTelegramCallbackQuery(payload)) {
    const callbackQuery = payload.callback_query;
    const message = callbackQuery.message;
    const chatId = message !== undefined ? String(message.chat.id) : 'unknown';
    const externalMessageId = callbackQuery.id;
    const userId = extractUserId(callbackQuery.from);
    const timestamp = message !== undefined ? new Date(message.date * 1000) : new Date();
    const callbackData = parseCallbackData(callbackQuery.data as string);

    if (callbackData === null) {
      return {
        messageType: 'UNSUPPORTED',
        chatId,
        userId,
        timestamp,
        channel: 'telegram',
        externalMessageId,
      };
    }

    return {
      messageType: 'CALLBACK',
      chatId,
      userId,
      callbackData,
      timestamp,
      channel: 'telegram',
      externalMessageId,
      rawPayload: payload,
    };
  }

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
  const externalMessageId = String(message.message_id);
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
      externalMessageId,
    };
  }

  return {
    messageType: 'TEXT',
    chatId,
    userId,
    text,
    timestamp,
    channel: 'telegram',
    externalMessageId,
  };
}

// LAYER: Infrastructure / Tests
// Unit tests for TelegramPayloadParser.
// Covers happy path, unsupported types, and malformed payloads.

import { describe, it, expect } from 'vitest';
import { parseTelegramPayload } from './TelegramPayloadParser';

describe('parseTelegramPayload', () => {
  describe('TEXT messages', () => {
    it('extracts all fields from a standard Telegram text payload', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          from: { id: 999, username: 'testuser' },
          chat: { id: 123456789 },
          text: 'Cafe con leche 850',
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('TEXT');
      expect(result.chatId).toBe('123456789');
      expect(result.userId).toBe('999');
      expect(result.text).toBe('Cafe con leche 850');
      expect(result.timestamp).toEqual(new Date(1716206400 * 1000));
      expect(result.channel).toBe('telegram');
      expect(result.externalMessageId).toBe('42');
    });

    it('trims whitespace from text', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          from: { id: 999 },
          chat: { id: 123456789 },
          text: '  Cafe con leche 850  ',
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.text).toBe('Cafe con leche 850');
    });

    it('handles missing username in from field', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          from: { id: 999 },
          chat: { id: 123456789 },
          text: 'Hello',
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.userId).toBe('999');
      expect(result.text).toBe('Hello');
    });

    it('handles string chat id', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          from: { id: 'user-999' },
          chat: { id: 'channel-123' },
          text: 'Hello',
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.chatId).toBe('channel-123');
      expect(result.userId).toBe('user-999');
      expect(result.externalMessageId).toBe('42');
    });

    it('handles string message id', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 'msg-abc',
          from: { id: 'user-999' },
          chat: { id: 'channel-123' },
          text: 'Hello',
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.externalMessageId).toBe('msg-abc');
    });
  });

  describe('UNSUPPORTED messages', () => {
    it('returns UNSUPPORTED for photo payload', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          from: { id: 999 },
          chat: { id: 123456789 },
          photo: [{ file_id: 'abc' }],
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('UNSUPPORTED');
      expect(result.chatId).toBe('123456789');
      expect(result.userId).toBe('999');
      expect(result.text).toBeUndefined();
      expect(result.timestamp).toEqual(new Date(1716206400 * 1000));
      expect(result.channel).toBe('telegram');
      expect(result.externalMessageId).toBe('42');
    });

    it('returns UNSUPPORTED for audio payload', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          from: { id: 999 },
          chat: { id: 123456789 },
          audio: { file_id: 'abc' },
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for sticker payload', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          from: { id: 999 },
          chat: { id: 123456789 },
          sticker: { file_id: 'abc' },
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED when text is an empty string', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          from: { id: 999 },
          chat: { id: 123456789 },
          text: '',
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('UNSUPPORTED');
      expect(result.text).toBeUndefined();
    });

    it('returns UNSUPPORTED when text is whitespace only', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          from: { id: 999 },
          chat: { id: 123456789 },
          text: '   ',
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('UNSUPPORTED');
      expect(result.text).toBeUndefined();
    });

    it('returns UNSUPPORTED when from is missing', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          chat: { id: 123456789 },
          photo: [{ file_id: 'abc' }],
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('UNSUPPORTED');
      expect(result.userId).toBeUndefined();
    });
  });

  describe('MALFORMED payloads', () => {
    it('returns MALFORMED for completely invalid JSON', () => {
      const payload = { unexpected: 'data' };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('MALFORMED');
      expect(result.chatId).toBe('unknown');
      expect(result.channel).toBe('telegram');
      expect(result.timestamp.getTime()).toBeGreaterThan(0);
      expect(result.externalMessageId).toBeUndefined();
      expect(result.rawPayload).toBe(payload);
    });

    it('returns MALFORMED when message is missing', () => {
      const payload = { update_id: 1 };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('MALFORMED');
      expect(result.rawPayload).toBe(payload);
    });

    it('returns MALFORMED when message is not an object', () => {
      const payload = { update_id: 1, message: 'not-an-object' };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('MALFORMED');
    });

    it('returns MALFORMED when message_id is missing', () => {
      const payload = {
        update_id: 1,
        message: {
          chat: { id: 123456789 },
          text: 'Hello',
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('MALFORMED');
      expect(result.externalMessageId).toBeUndefined();
    });

    it('returns MALFORMED when message_id is not a number or string', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: null,
          chat: { id: 123456789 },
          text: 'Hello',
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('MALFORMED');
    });

    it('returns MALFORMED when chat is missing', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('MALFORMED');
    });

    it('returns MALFORMED when chat.id is not a number or string', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          chat: { id: null },
          date: 1716206400,
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('MALFORMED');
    });

    it('returns MALFORMED when date is missing', () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 42,
          chat: { id: 123456789 },
          text: 'Hello',
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('MALFORMED');
    });

    it('returns MALFORMED for null payload', () => {
      const result = parseTelegramPayload(null);

      expect(result.messageType).toBe('MALFORMED');
      expect(result.rawPayload).toBeNull();
    });

    it('returns MALFORMED for string payload', () => {
      const result = parseTelegramPayload('not-json');

      expect(result.messageType).toBe('MALFORMED');
    });

    it('returns MALFORMED for number payload', () => {
      const result = parseTelegramPayload(42);

      expect(result.messageType).toBe('MALFORMED');
    });
  });

  describe('CALLBACK messages', () => {
    it('extracts all fields from a valid callback query', () => {
      const payload = {
        update_id: 2,
        callback_query: {
          id: 'query-123',
          from: { id: 999, username: 'testuser' },
          message: {
            message_id: 42,
            chat: { id: 123456789 },
            date: 1716206400,
          },
          data: JSON.stringify({ action: 'confirm' }),
        },
      };

      const result = parseTelegramPayload(payload);

      expect(result.messageType).toBe('CALLBACK');
      expect(result.chatId).toBe('123456789');
      expect(result.userId).toBe('999');
      expect(result.externalMessageId).toBe('query-123');
      expect(result.callbackData).toEqual({ action: 'confirm' });
      expect(result.timestamp).toEqual(new Date(1716206400 * 1000));
      expect(result.channel).toBe('telegram');
      expect(result.rawPayload).toBe(payload);
    });

    it('parses correct and cancel actions', () => {
      const correct = parseTelegramPayload({
        update_id: 1,
        callback_query: {
          id: 'q1',
          from: { id: 1 },
          message: { message_id: 1, chat: { id: 1 }, date: 1 },
          data: JSON.stringify({ action: 'correct' }),
        },
      });

      const cancel = parseTelegramPayload({
        update_id: 1,
        callback_query: {
          id: 'q2',
          from: { id: 1 },
          message: { message_id: 1, chat: { id: 1 }, date: 1 },
          data: JSON.stringify({ action: 'cancel' }),
        },
      });

      expect(correct.callbackData).toEqual({ action: 'correct' });
      expect(cancel.callbackData).toEqual({ action: 'cancel' });
    });

    it('parses callback data with optional field', () => {
      const result = parseTelegramPayload({
        update_id: 1,
        callback_query: {
          id: 'q1',
          from: { id: 1 },
          message: { message_id: 1, chat: { id: 1 }, date: 1 },
          data: JSON.stringify({ action: 'correct', field: 'monto' }),
        },
      });

      expect(result.callbackData).toEqual({ action: 'correct', field: 'monto' });
    });

    it('returns UNSUPPORTED when callback data is unknown', () => {
      const result = parseTelegramPayload({
        update_id: 1,
        callback_query: {
          id: 'q1',
          from: { id: 1 },
          message: { message_id: 1, chat: { id: 1 }, date: 1 },
          data: JSON.stringify({ action: 'unknown' }),
        },
      });

      expect(result.messageType).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED when callback data is not valid JSON', () => {
      const result = parseTelegramPayload({
        update_id: 1,
        callback_query: {
          id: 'q1',
          from: { id: 1 },
          message: { message_id: 1, chat: { id: 1 }, date: 1 },
          data: 'not-json',
        },
      });

      expect(result.messageType).toBe('UNSUPPORTED');
    });

    it('returns MALFORMED when callback_query id is missing', () => {
      const result = parseTelegramPayload({
        update_id: 1,
        callback_query: {
          from: { id: 1 },
          message: { message_id: 1, chat: { id: 1 }, date: 1 },
          data: JSON.stringify({ action: 'confirm' }),
        },
      });

      expect(result.messageType).toBe('MALFORMED');
    });
  });
});

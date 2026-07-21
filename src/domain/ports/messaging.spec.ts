// LAYER: Domain / Tests
// Type-level contract tests for NormalizedPayload.
// Ensures the port interface satisfies downstream usage patterns.

import { describe, it, expect } from 'vitest';
import type { NormalizedPayload } from './messaging';

describe('NormalizedPayload', () => {
  it('accepts a complete TEXT payload', () => {
    const payload: NormalizedPayload = {
      messageType: 'TEXT',
      chatId: '123456789',
      userId: 'user-123',
      text: 'Cafe con leche 850',
      timestamp: new Date('2026-05-20T12:00:00Z'),
      channel: 'telegram',
      externalMessageId: 'msg-42',
    };

    expect(payload.messageType).toBe('TEXT');
    expect(payload.chatId).toBe('123456789');
    expect(payload.userId).toBe('user-123');
    expect(payload.text).toBe('Cafe con leche 850');
    expect(payload.channel).toBe('telegram');
    expect(payload.externalMessageId).toBe('msg-42');
  });

  it('accepts an UNSUPPORTED payload without userId or text', () => {
    const payload: NormalizedPayload = {
      messageType: 'UNSUPPORTED',
      chatId: '123456789',
      timestamp: new Date('2026-05-20T12:00:00Z'),
      channel: 'whatsapp',
    };

    expect(payload.messageType).toBe('UNSUPPORTED');
    expect(payload.userId).toBeUndefined();
    expect(payload.text).toBeUndefined();
  });

  it('accepts a MALFORMED payload with rawPayload for logging', () => {
    const raw = { unexpected: 'data' };
    const payload: NormalizedPayload = {
      messageType: 'MALFORMED',
      chatId: 'unknown',
      timestamp: new Date('2026-05-20T12:00:00Z'),
      channel: 'telegram',
      rawPayload: raw,
    };

    expect(payload.messageType).toBe('MALFORMED');
    expect(payload.rawPayload).toBe(raw);
  });

  it('narrows message type through discriminated union pattern', () => {
    function getHandler(payload: NormalizedPayload): string {
      switch (payload.messageType) {
        case 'TEXT':
          return 'text-handler';
        case 'UNSUPPORTED':
          return 'unsupported-handler';
        case 'MALFORMED':
          return 'malformed-handler';
        default:
          // Exhaustiveness check
          return 'unknown';
      }
    }

    const textPayload: NormalizedPayload = {
      messageType: 'TEXT',
      chatId: '1',
      text: 'hello',
      timestamp: new Date(),
      channel: 'telegram',
    };

    expect(getHandler(textPayload)).toBe('text-handler');
  });

  it('supports explicit undefined for optional properties', () => {
    const payload: NormalizedPayload = {
      messageType: 'TEXT',
      chatId: '1',
      userId: undefined,
      text: undefined,
      timestamp: new Date(),
      channel: 'telegram',
      externalMessageId: undefined,
      rawPayload: undefined,
    };

    expect(payload.userId).toBeUndefined();
    expect(payload.text).toBeUndefined();
    expect(payload.externalMessageId).toBeUndefined();
    expect(payload.rawPayload).toBeUndefined();
  });
});

// LAYER: Domain / Tests
// Unit tests for ProcessedMessageKey value object.
// Validates construction rules, channel restriction, and equality.

import { describe, it, expect } from 'vitest';
import { ProcessedMessageKey } from './ProcessedMessageKey';
import { DomainValidationError } from '../errors/DomainValidationError';

function makeValidProps() {
  return {
    channel: 'telegram' as const,
    externalMessageId: 'msg-12345',
  };
}

describe('ProcessedMessageKey', () => {
  describe('construction', () => {
    it('creates a valid telegram key', () => {
      const key = new ProcessedMessageKey(makeValidProps());
      expect(key.channel).toBe('telegram');
      expect(key.externalMessageId).toBe('msg-12345');
    });

    it('creates a valid whatsapp key', () => {
      const key = new ProcessedMessageKey({
        channel: 'whatsapp',
        externalMessageId: 'wpp-67890',
      });
      expect(key.channel).toBe('whatsapp');
      expect(key.externalMessageId).toBe('wpp-67890');
    });

    it('throws DomainValidationError when channel is invalid', () => {
      const props = { channel: 'email' as 'telegram', externalMessageId: 'msg-12345' };
      expect(() => new ProcessedMessageKey(props)).toThrow(DomainValidationError);
      expect(() => new ProcessedMessageKey(props)).toThrow('channel must be');
    });

    it('throws DomainValidationError when externalMessageId is empty', () => {
      const props = { ...makeValidProps(), externalMessageId: '' };
      expect(() => new ProcessedMessageKey(props)).toThrow(DomainValidationError);
      expect(() => new ProcessedMessageKey(props)).toThrow('externalMessageId is required');
    });

    it('throws DomainValidationError when externalMessageId is whitespace only', () => {
      const props = { ...makeValidProps(), externalMessageId: '   ' };
      expect(() => new ProcessedMessageKey(props)).toThrow(DomainValidationError);
    });
  });

  describe('immutability', () => {
    it('throws when attempting to mutate channel at runtime', () => {
      const key = new ProcessedMessageKey(makeValidProps());
      expect(() => {
        (key as unknown as Record<string, unknown>).channel = 'whatsapp';
      }).toThrow();
    });

    it('throws when attempting to mutate externalMessageId at runtime', () => {
      const key = new ProcessedMessageKey(makeValidProps());
      expect(() => {
        (key as unknown as Record<string, unknown>).externalMessageId = '999';
      }).toThrow();
    });
  });

  describe('equality', () => {
    it('returns true for two keys with identical properties', () => {
      const props = makeValidProps();
      const a = new ProcessedMessageKey(props);
      const b = new ProcessedMessageKey(props);
      expect(a.equals(b)).toBe(true);
    });

    it('returns false when channel differs', () => {
      const a = new ProcessedMessageKey(makeValidProps());
      const b = new ProcessedMessageKey({ ...makeValidProps(), channel: 'whatsapp' });
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when externalMessageId differs', () => {
      const a = new ProcessedMessageKey(makeValidProps());
      const b = new ProcessedMessageKey({ ...makeValidProps(), externalMessageId: 'msg-999' });
      expect(a.equals(b)).toBe(false);
    });
  });
});

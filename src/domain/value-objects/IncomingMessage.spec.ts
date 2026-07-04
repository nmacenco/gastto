// LAYER: Domain / Tests
// Unit tests for IncomingMessage value object.
// Validates construction rules, immutability, and equality.

import { describe, it, expect } from 'vitest';
import { IncomingMessage } from './IncomingMessage';
import { DomainValidationError } from '../errors/DomainValidationError';

function makeValidProps() {
  return {
    chatId: '123456789',
    userId: 'user-123',
    text: 'Cafe con leche 850',
    timestamp: new Date('2026-05-20T12:00:00Z'),
    channel: 'telegram' as const,
  };
}

describe('IncomingMessage', () => {
  describe('construction', () => {
    it('creates a valid IncomingMessage with all required fields', () => {
      const props = makeValidProps();
      const message = new IncomingMessage(props);

      expect(message.chatId).toBe('123456789');
      expect(message.userId).toBe('user-123');
      expect(message.text).toBe('Cafe con leche 850');
      expect(message.timestamp).toEqual(new Date('2026-05-20T12:00:00Z'));
      expect(message.channel).toBe('telegram');
      expect(message.messageType).toBe('TEXT');
    });

    it('throws DomainValidationError when chatId is empty', () => {
      const props = { ...makeValidProps(), chatId: '' };
      expect(() => new IncomingMessage(props)).toThrow(DomainValidationError);
      expect(() => new IncomingMessage(props)).toThrow('chatId is required');
    });

    it('throws DomainValidationError when chatId is whitespace only', () => {
      const props = { ...makeValidProps(), chatId: '   ' };
      expect(() => new IncomingMessage(props)).toThrow(DomainValidationError);
    });

    it('throws DomainValidationError when userId is empty', () => {
      const props = { ...makeValidProps(), userId: '' };
      expect(() => new IncomingMessage(props)).toThrow(DomainValidationError);
      expect(() => new IncomingMessage(props)).toThrow('userId is required');
    });

    it('throws DomainValidationError when text is empty', () => {
      const props = { ...makeValidProps(), text: '' };
      expect(() => new IncomingMessage(props)).toThrow(DomainValidationError);
      expect(() => new IncomingMessage(props)).toThrow('text is required');
    });

    it('throws DomainValidationError when timestamp is missing', () => {
      const props = { ...makeValidProps(), timestamp: undefined as unknown as Date };
      expect(() => new IncomingMessage(props)).toThrow(DomainValidationError);
      expect(() => new IncomingMessage(props)).toThrow('timestamp is required');
    });

    it('throws DomainValidationError when channel is invalid', () => {
      const props = { ...makeValidProps(), channel: 'email' as 'telegram' };
      expect(() => new IncomingMessage(props)).toThrow(DomainValidationError);
      expect(() => new IncomingMessage(props)).toThrow('channel must be');
    });

    it('accepts "whatsapp" as a valid channel', () => {
      const props = { ...makeValidProps(), channel: 'whatsapp' as const };
      const message = new IncomingMessage(props);
      expect(message.channel).toBe('whatsapp');
    });
  });

  describe('immutability', () => {
    it('throws when attempting to mutate chatId at runtime', () => {
      const message = new IncomingMessage(makeValidProps());
      expect(() => {
        (message as unknown as Record<string, unknown>).chatId = '999';
      }).toThrow();
    });

    it('throws when attempting to mutate text at runtime', () => {
      const message = new IncomingMessage(makeValidProps());
      expect(() => {
        (message as unknown as Record<string, unknown>).text = 'new text';
      }).toThrow();
    });
  });

  describe('equality', () => {
    it('returns true for two messages with identical properties', () => {
      const props = makeValidProps();
      const a = new IncomingMessage(props);
      const b = new IncomingMessage(props);
      expect(a.equals(b)).toBe(true);
    });

    it('returns false when chatId differs', () => {
      const a = new IncomingMessage(makeValidProps());
      const b = new IncomingMessage({ ...makeValidProps(), chatId: '999' });
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when timestamp differs', () => {
      const a = new IncomingMessage(makeValidProps());
      const b = new IncomingMessage({
        ...makeValidProps(),
        timestamp: new Date('2026-05-20T13:00:00Z'),
      });
      expect(a.equals(b)).toBe(false);
    });
  });
});

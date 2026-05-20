// LAYER: Domain / Tests
// Type-level and runtime tests for MessageType.

import { describe, it, expect } from 'vitest';
import type { MessageType } from './MessageType';

describe('MessageType', () => {
  it('accepts "TEXT" as a valid value', () => {
    const type: MessageType = 'TEXT';
    expect(type).toBe('TEXT');
  });

  it('accepts "UNSUPPORTED" as a valid value', () => {
    const type: MessageType = 'UNSUPPORTED';
    expect(type).toBe('UNSUPPORTED');
  });

  it('accepts "MALFORMED" as a valid value', () => {
    const type: MessageType = 'MALFORMED';
    expect(type).toBe('MALFORMED');
  });

  it('narrows correctly in a switch statement', () => {
    function getLabel(type: MessageType): string {
      switch (type) {
        case 'TEXT':
          return 'text message';
        case 'UNSUPPORTED':
          return 'unsupported';
        case 'MALFORMED':
          return 'malformed';
        default:
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          return `unknown: ${type}`;
      }
    }

    expect(getLabel('TEXT')).toBe('text message');
    expect(getLabel('UNSUPPORTED')).toBe('unsupported');
    expect(getLabel('MALFORMED')).toBe('malformed');
  });
});

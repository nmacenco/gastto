import { describe, expect, it } from 'vitest';
import { composeMessage } from './compose-message';

describe('composeMessage', () => {
  it('orders blocks and separates the exit from the action list', () => {
    expect(
      composeMessage({ exit: 'Salir.', action: '1. Abrir\n2. Elegir', explanation: 'Problema.' }),
    ).toBe('Problema.\n\n1. Abrir\n2. Elegir\n\nSalir.');
  });

  it('trims block boundaries without changing internal paragraphs, indentation or URLs', () => {
    expect(
      composeMessage({
        explanation: '  Opciones:\n ',
        action: '\n• Viajes\n  ◦ Peajes\n\nhttps://example.com/a?x=1&y=2  ',
        exit: ' \n ',
      }),
    ).toBe('Opciones:\n\n• Viajes\n  ◦ Peajes\n\nhttps://example.com/a?x=1&y=2');
  });

  it('omits absent blocks without adding separators', () => {
    expect(composeMessage({ action: 'Listo.' })).toBe('Listo.');
    expect(composeMessage({ explanation: ' \n', exit: '\t' })).toBe('');
    expect(composeMessage({})).toBe('');
  });
});

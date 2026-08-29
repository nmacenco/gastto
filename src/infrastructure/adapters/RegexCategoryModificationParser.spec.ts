// LAYER: Infrastructure / Tests
// Unit tests for RegexCategoryModificationParser.
// Covers Spanish and English add/remove/rename patterns with normalization.

import { describe, it, expect } from 'vitest';
import { RegexCategoryModificationParser } from './RegexCategoryModificationParser';

describe('RegexCategoryModificationParser', () => {
  const parser = new RegexCategoryModificationParser();

  describe('add category intent', () => {
    it('parses Spanish "falta" pattern', async () => {
      const result = await parser.parse('falta Salud');
      expect(result).toEqual({ kind: 'add', name: 'salud' });
    });

    it('parses Spanish "agrega la categoría" pattern', async () => {
      const result = await parser.parse('agrega la categoría Viajes');
      expect(result).toEqual({ kind: 'add', name: 'viajes' });
    });

    it('parses the reported Spanish "agregar cine" command', async () => {
      const result = await parser.parse('agregar cine');
      expect(result).toEqual({ kind: 'add', name: 'cine' });
    });

    it('parses English "add" pattern', async () => {
      const result = await parser.parse('add Education');
      expect(result).toEqual({ kind: 'add', name: 'education' });
    });

    it('parses English "missing the category" pattern', async () => {
      const result = await parser.parse('missing the category Health');
      expect(result).toEqual({ kind: 'add', name: 'health' });
    });

    it('handles accents and punctuation in add pattern', async () => {
      const result = await parser.parse('¡Falta Educación!');
      expect(result).toEqual({ kind: 'add', name: 'educacion' });
    });
  });

  describe('remove category intent', () => {
    it.each(['quitar ocio', 'elimina la categoría ocio', 'borrar ocio'])(
      'parses Spanish command "%s"',
      async (command) => {
        await expect(parser.parse(command)).resolves.toEqual({ kind: 'remove', name: 'ocio' });
      },
    );

    it.each(['remove leisure', 'delete the category leisure'])(
      'parses English command "%s"',
      async (command) => {
        await expect(parser.parse(command)).resolves.toEqual({
          kind: 'remove',
          name: 'leisure',
        });
      },
    );
  });

  describe('rename category intent', () => {
    it('parses Spanish "se llama" pattern', async () => {
      const result = await parser.parse('Ocio se llama Entretenimiento');
      expect(result).toEqual({ kind: 'rename', from: 'ocio', to: 'entretenimiento' });
    });

    it('parses Spanish "la categoría X es Y" pattern', async () => {
      const result = await parser.parse('la categoría Comida es Alimentación');
      expect(result).toEqual({ kind: 'rename', from: 'comida', to: 'alimentacion' });
    });

    it('parses English "is actually" pattern', async () => {
      const result = await parser.parse('Leisure is actually Entertainment');
      expect(result).toEqual({ kind: 'rename', from: 'leisure', to: 'entertainment' });
    });

    it('parses English "should be" pattern', async () => {
      const result = await parser.parse('Food should be Meals');
      expect(result).toEqual({ kind: 'rename', from: 'food', to: 'meals' });
    });

    it('parses English "rename to" pattern', async () => {
      const result = await parser.parse('rename the category Transport to Transit');
      expect(result).toEqual({ kind: 'rename', from: 'transport', to: 'transit' });
    });

    it('handles accents and extra words in rename pattern', async () => {
      const result = await parser.parse('la categoría Ocío debería ser Entretenimíento');
      expect(result).toEqual({ kind: 'rename', from: 'ocio', to: 'entretenimiento' });
    });
  });

  describe('unknown intent', () => {
    it('returns unknown for random text', async () => {
      const result = await parser.parse('hello world');
      expect(result).toEqual({ kind: 'unknown' });
    });

    it('returns unknown for empty string', async () => {
      const result = await parser.parse('');
      expect(result).toEqual({ kind: 'unknown' });
    });

    it('returns unknown for confirm-like text that does not match patterns', async () => {
      const result = await parser.parse('sí, está bien');
      expect(result).toEqual({ kind: 'unknown' });
    });
  });
});

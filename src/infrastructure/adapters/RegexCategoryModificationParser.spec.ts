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
      expect(result).toEqual({ kind: 'add', name: 'Salud' });
    });

    it('parses Spanish "agrega la categoría" pattern', async () => {
      const result = await parser.parse('agrega la categoría Viajes');
      expect(result).toEqual({ kind: 'add', name: 'Viajes' });
    });

    it('parses the reported Spanish "agregar cine" command', async () => {
      const result = await parser.parse('agregar cine');
      expect(result).toEqual({ kind: 'add', name: 'cine' });
    });

    it('parses English "add" pattern', async () => {
      const result = await parser.parse('add Education');
      expect(result).toEqual({ kind: 'add', name: 'Education' });
    });

    it('parses English "missing the category" pattern', async () => {
      const result = await parser.parse('missing the category Health');
      expect(result).toEqual({ kind: 'add', name: 'Health' });
    });

    it('handles accents and punctuation in add pattern', async () => {
      const result = await parser.parse('¡Falta Educación!');
      expect(result).toEqual({ kind: 'add', name: 'Educación' });
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
      expect(result).toEqual({ kind: 'rename', from: 'Ocio', to: 'Entretenimiento' });
    });

    it('parses Spanish "la categoría X es Y" pattern', async () => {
      const result = await parser.parse('la categoría Comida es Alimentación');
      expect(result).toEqual({ kind: 'rename', from: 'Comida', to: 'Alimentación' });
    });

    it('parses English "is actually" pattern', async () => {
      const result = await parser.parse('Leisure is actually Entertainment');
      expect(result).toEqual({ kind: 'rename', from: 'Leisure', to: 'Entertainment' });
    });

    it('parses English "should be" pattern', async () => {
      const result = await parser.parse('Food should be Meals');
      expect(result).toEqual({ kind: 'rename', from: 'Food', to: 'Meals' });
    });

    it('parses English "rename to" pattern', async () => {
      const result = await parser.parse('rename the category Transport to Transit');
      expect(result).toEqual({ kind: 'rename', from: 'Transport', to: 'Transit' });
    });

    it('handles accents and extra words in rename pattern', async () => {
      const result = await parser.parse('la categoría Ocío debería ser Entretenimíento');
      expect(result).toEqual({ kind: 'rename', from: 'Ocío', to: 'Entretenimíento' });
    });
  });

  describe('subcategory intents', () => {
    it.each([
      [
        'add Tolls to Transportation',
        { kind: 'add-subcategory', name: 'Tolls', parent: 'Transportation' },
      ],
      [
        'agregar Peajes a Transporte',
        { kind: 'add-subcategory', name: 'Peajes', parent: 'Transporte' },
      ],
      [
        'under Food, rename Delivery to Takeout',
        { kind: 'rename-subcategory', from: 'Delivery', to: 'Takeout', parent: 'Food' },
      ],
      [
        'en Comida, renombra Delivery a Para llevar',
        {
          kind: 'rename-subcategory',
          from: 'Delivery',
          to: 'Para llevar',
          parent: 'Comida',
        },
      ],
      [
        'move Streaming from Utilities to Leisure',
        {
          kind: 'move-subcategory',
          name: 'Streaming',
          fromParent: 'Utilities',
          toParent: 'Leisure',
        },
      ],
      [
        'mueve Streaming de Servicios a Ocio',
        {
          kind: 'move-subcategory',
          name: 'Streaming',
          fromParent: 'Servicios',
          toParent: 'Ocio',
        },
      ],
      [
        'remove Cinema from Leisure',
        { kind: 'remove-subcategory', name: 'Cinema', parent: 'Leisure' },
      ],
      ['quita Cine de Ocio', { kind: 'remove-subcategory', name: 'Cine', parent: 'Ocio' }],
    ])('parses "%s" before flat category patterns', async (command, expected) => {
      await expect(parser.parse(command)).resolves.toEqual(expected);
    });

    it('normalizes surrounding whitespace and command case while preserving names', async () => {
      await expect(parser.parse('  ADD   Café diario   TO   Gastos Útiles!! ')).resolves.toEqual({
        kind: 'add-subcategory',
        name: 'Café diario',
        parent: 'Gastos Útiles',
      });
    });

    it('preserves meaningful punctuation inside user-provided names', async () => {
      await expect(parser.parse('add Health & Wellness to Personal-Care')).resolves.toEqual({
        kind: 'add-subcategory',
        name: 'Health & Wellness',
        parent: 'Personal-Care',
      });
    });

    it.each([
      'add subcategory Tolls',
      'add Tolls to',
      'agregar Peajes a',
      'move Streaming to Leisure',
      'move Streaming from Utilities',
      'under Food rename Delivery',
      'under Food rename Delivery to',
      'remove subcategory Cinema',
      'remove Cinema from',
    ])('rejects incomplete parent-aware command "%s"', async (command) => {
      await expect(parser.parse(command)).resolves.toEqual({ kind: 'unknown' });
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

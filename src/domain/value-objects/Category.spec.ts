// LAYER: Domain tests
// Pure domain tests for Category.

import { describe, it, expect } from 'vitest';
import { Category } from './Category';
import { normalizeCategoryName } from './Category';

describe('Category', () => {
  it('creates a category with a name', () => {
    const category = Category.create({ name: 'Food' });

    expect(category.name).toBe('Food');
    expect(category.displayLabel).toBeNull();
    expect(category.order).toBe(0);
  });

  it('trims surrounding whitespace from the name', () => {
    const category = Category.create({ name: '  Food  ' });

    expect(category.name).toBe('Food');
  });

  it('preserves inner whitespace and casing in the display name', () => {
    const category = Category.create({ name: '  Dining Out  ' });

    expect(category.name).toBe('Dining Out');
  });

  it('accepts an optional display label and order', () => {
    const category = Category.create({
      name: 'Food',
      displayLabel: 'Comida',
      order: 3,
    });

    expect(category.displayLabel).toBe('Comida');
    expect(category.order).toBe(3);
  });

  it('treats an empty display label as null', () => {
    const category = Category.create({ name: 'Food', displayLabel: '   ' });

    expect(category.displayLabel).toBeNull();
  });

  it('rejects an empty name', () => {
    expect(() => Category.create({ name: '' })).toThrow('Category name cannot be empty');
    expect(() => Category.create({ name: '   ' })).toThrow('Category name cannot be empty');
  });

});

describe('normalizeCategoryName', () => {
  it('lowercases and removes accents', () => {
    expect(normalizeCategoryName('  Categoría  ')).toBe('categoria');
    expect(normalizeCategoryName('Saúde')).toBe('saude');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeCategoryName('  Food   &   Drink  ')).toBe('food & drink');
  });
});

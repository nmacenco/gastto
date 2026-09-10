// LAYER: Domain / Tests
// Unit tests for CategoryVocabulary aggregate invariants.

import { describe, expect, it } from 'vitest';
import { DomainValidationError } from '../errors/DomainValidationError';
import { CategoryVocabulary } from './CategoryVocabulary';

const food = { id: 'cat-food', name: 'Food', normalizedName: 'food' };
const leisure = { id: 'cat-leisure', name: 'Leisure', normalizedName: 'leisure' };
const restaurant = {
  id: 'sub-restaurant',
  categoryId: food.id,
  name: 'Restaurant',
  normalizedName: 'restaurant',
};

describe('CategoryVocabulary', () => {
  it('constructs an empty vocabulary by default', () => {
    const vocabulary = new CategoryVocabulary('sheet-1');

    expect(vocabulary.getCategories()).toEqual([]);
    expect(vocabulary.getSubcategories()).toEqual([]);
  });

  it('constructs and reads a complete hierarchy without exposing mutable state', () => {
    const vocabulary = new CategoryVocabulary('sheet-1', [food], [restaurant]);
    const categories = vocabulary.getCategories() as (typeof food)[];
    const subcategories = vocabulary.getSubcategories() as (typeof restaurant)[];

    categories[0]!.name = 'Changed';
    subcategories[0]!.name = 'Changed';
    categories.push(leisure);
    subcategories.splice(0, 1);

    expect(vocabulary.getCategories()).toEqual([food]);
    expect(vocabulary.getSubcategories()).toEqual([restaurant]);
  });

  it('adds, normalizes, and generates an id for a category', () => {
    const vocabulary = new CategoryVocabulary('sheet-1');
    const category = vocabulary.addCategory('  Food  ');

    expect(category).toMatchObject({ name: 'Food', normalizedName: 'food' });
    expect(category.id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('rejects blank and duplicate category names', () => {
    const vocabulary = new CategoryVocabulary('sheet-1', [food]);

    expect(() => vocabulary.addCategory('   ')).toThrow(DomainValidationError);
    expect(() => vocabulary.addCategory(' FOOD ')).toThrow(DomainValidationError);
  });

  it('renames a category while preserving its id and rejecting invalid targets', () => {
    const vocabulary = new CategoryVocabulary('sheet-1', [food, leisure]);

    expect(vocabulary.renameCategory(food.id, 'Groceries')).toEqual({
      id: food.id,
      name: 'Groceries',
      normalizedName: 'groceries',
    });
    expect(() => vocabulary.renameCategory(food.id, '   ')).toThrow(DomainValidationError);
    expect(() => vocabulary.renameCategory(food.id, 'Leisure')).toThrow(DomainValidationError);
    expect(() => vocabulary.renameCategory('missing', 'Other')).toThrow(DomainValidationError);
  });

  it('adds a normalized subcategory with a generated id under an existing parent', () => {
    const vocabulary = new CategoryVocabulary('sheet-1', [food]);
    const subcategory = vocabulary.addSubcategory(food.id, '  Restaurant  ');

    expect(subcategory).toMatchObject({
      categoryId: food.id,
      name: 'Restaurant',
      normalizedName: 'restaurant',
    });
    expect(subcategory.id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('rejects blank subcategories, missing parents, and duplicates within one parent', () => {
    const vocabulary = new CategoryVocabulary('sheet-1', [food], [restaurant]);

    expect(() => vocabulary.addSubcategory(food.id, '   ')).toThrow(DomainValidationError);
    expect(() => vocabulary.addSubcategory('missing', 'Restaurant')).toThrow(DomainValidationError);
    expect(() => vocabulary.addSubcategory(food.id, ' RESTAURANT ')).toThrow(DomainValidationError);
  });

  it('permits equal normalized subcategory names under different parents', () => {
    const vocabulary = new CategoryVocabulary('sheet-1', [food, leisure], [restaurant]);

    const second = vocabulary.addSubcategory(leisure.id, 'RESTAURANT');

    expect(second.categoryId).toBe(leisure.id);
    expect(vocabulary.getSubcategories()).toHaveLength(2);
  });

  it('finds and filters subcategories only within the requested parent', () => {
    const leisureRestaurant = { ...restaurant, id: 'sub-leisure', categoryId: leisure.id };
    const vocabulary = new CategoryVocabulary(
      'sheet-1',
      [food, leisure],
      [restaurant, leisureRestaurant],
    );

    expect(vocabulary.findSubcategory(food.id, ' RESTAURANT ')).toEqual(restaurant);
    expect(vocabulary.getSubcategories(food.id)).toEqual([restaurant]);
    expect(vocabulary.findSubcategory(food.id, 'Cinema')).toBeUndefined();
  });

  it('renames only the selected child and preserves its id and parent', () => {
    const leisureRestaurant = { ...restaurant, id: 'sub-leisure', categoryId: leisure.id };
    const vocabulary = new CategoryVocabulary(
      'sheet-1',
      [food, leisure],
      [restaurant, leisureRestaurant],
    );

    expect(vocabulary.renameSubcategory(restaurant.id, 'Takeout')).toEqual({
      id: restaurant.id,
      categoryId: food.id,
      name: 'Takeout',
      normalizedName: 'takeout',
    });
    expect(vocabulary.findSubcategory(leisure.id, 'Restaurant')).toEqual(leisureRestaurant);
  });

  it('rejects invalid subcategory renames and missing children', () => {
    const takeout = {
      id: 'sub-takeout',
      categoryId: food.id,
      name: 'Takeout',
      normalizedName: 'takeout',
    };
    const vocabulary = new CategoryVocabulary('sheet-1', [food], [restaurant, takeout]);

    expect(() => vocabulary.renameSubcategory(restaurant.id, '   ')).toThrow(DomainValidationError);
    expect(() => vocabulary.renameSubcategory(restaurant.id, 'TAKEOUT')).toThrow(
      DomainValidationError,
    );
    expect(() => vocabulary.renameSubcategory('missing', 'Other')).toThrow(DomainValidationError);
  });

  it('moves a child atomically while preserving its id and name', () => {
    const vocabulary = new CategoryVocabulary('sheet-1', [food, leisure], [restaurant]);

    expect(vocabulary.moveSubcategory(restaurant.id, leisure.id)).toEqual({
      ...restaurant,
      categoryId: leisure.id,
    });
    expect(vocabulary.getSubcategories(food.id)).toEqual([]);
    expect(vocabulary.getSubcategories(leisure.id)).toEqual([
      { ...restaurant, categoryId: leisure.id },
    ]);
  });

  it('rejects move collisions and missing child or parent identifiers without mutation', () => {
    const leisureRestaurant = { ...restaurant, id: 'sub-leisure', categoryId: leisure.id };
    const vocabulary = new CategoryVocabulary(
      'sheet-1',
      [food, leisure],
      [restaurant, leisureRestaurant],
    );

    expect(() => vocabulary.moveSubcategory(restaurant.id, leisure.id)).toThrow(
      DomainValidationError,
    );
    expect(() => vocabulary.moveSubcategory('missing', leisure.id)).toThrow(DomainValidationError);
    expect(() => vocabulary.moveSubcategory(restaurant.id, 'missing')).toThrow(
      DomainValidationError,
    );
    expect(vocabulary.getSubcategories(food.id)).toEqual([restaurant]);
  });

  it('removes one child and rejects an unknown child', () => {
    const cinema = {
      id: 'sub-cinema',
      categoryId: food.id,
      name: 'Cinema',
      normalizedName: 'cinema',
    };
    const vocabulary = new CategoryVocabulary('sheet-1', [food], [restaurant, cinema]);

    vocabulary.removeSubcategory(restaurant.id);

    expect(vocabulary.getSubcategories()).toEqual([cinema]);
    expect(() => vocabulary.removeSubcategory('missing')).toThrow(DomainValidationError);
  });

  it('removes a category and its complete child branch', () => {
    const leisureRestaurant = { ...restaurant, id: 'sub-leisure', categoryId: leisure.id };
    const vocabulary = new CategoryVocabulary(
      'sheet-1',
      [food, leisure],
      [restaurant, leisureRestaurant],
    );

    vocabulary.removeCategory(food.id);

    expect(vocabulary.getCategories()).toEqual([leisure]);
    expect(vocabulary.getSubcategories()).toEqual([leisureRestaurant]);
  });
});

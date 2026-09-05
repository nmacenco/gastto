// LAYER: Application / Tests

import { describe, expect, it } from 'vitest';
import {
  parseCategoryOnboardingState,
  serializeCategoryOnboardingState,
  type CategoryOnboardingState,
} from './CategoryOnboardingState';

describe('CategoryOnboardingState', () => {
  it('round-trips canonical hierarchy state', () => {
    const state: CategoryOnboardingState = {
      categories: [
        { name: 'Food', subcategories: ['Restaurant', 'Groceries'] },
        { name: 'Leisure', subcategories: ['Restaurant'] },
      ],
      orphanSubcategories: ['Streaming'],
      subcategoryColumnMapped: true,
    };

    expect(parseCategoryOnboardingState(serializeCategoryOnboardingState(state))).toEqual(state);
  });

  it('preserves unrelated payload metadata when serializing', () => {
    const state: CategoryOnboardingState = {
      categories: [{ name: 'Food', subcategories: [] }],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    };

    expect(
      serializeCategoryOnboardingState(state, { headerRowIndex: 3, selectedFileId: 'file-1' }),
    ).toEqual({
      headerRowIndex: 3,
      selectedFileId: 'file-1',
      ...state,
    });
  });

  it('upgrades a legacy flat category payload', () => {
    expect(parseCategoryOnboardingState({ categories: ['Food', 'Transport'] })).toEqual({
      categories: [
        { name: 'Food', subcategories: [] },
        { name: 'Transport', subcategories: [] },
      ],
      orphanSubcategories: [],
      subcategoryColumnMapped: false,
    });
  });

  it('accepts an empty legacy category list', () => {
    expect(parseCategoryOnboardingState({ categories: [] })).toEqual({
      categories: [],
      orphanSubcategories: [],
      subcategoryColumnMapped: false,
    });
  });

  it.each([
    {
      categories: [{ name: 42, subcategories: [] }],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    },
    {
      categories: [{ name: 'Food', subcategories: 'Restaurant' }],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    },
    {
      categories: [{ name: 'Food', subcategories: [42] }],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    },
    {
      categories: [{ name: 'Food', subcategories: [] }],
      orphanSubcategories: [42],
      subcategoryColumnMapped: true,
    },
    {
      categories: [{ name: '', subcategories: [] }],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    },
    {
      categories: ['Food'],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    },
  ])('rejects malformed canonical payloads: %#', (payload) => {
    expect(parseCategoryOnboardingState(payload)).toBeNull();
  });

  it('deduplicates categories and children through aggregate invariants', () => {
    expect(
      parseCategoryOnboardingState({
        categories: [
          { name: ' Food ', subcategories: ['Restaurant', ' restaurant '] },
          { name: 'food', subcategories: ['Groceries'] },
          { name: 'Leisure', subcategories: ['Restaurant'] },
        ],
        orphanSubcategories: ['Streaming', ' streaming '],
        subcategoryColumnMapped: true,
      }),
    ).toEqual({
      categories: [
        { name: 'Food', subcategories: ['Restaurant', 'Groceries'] },
        { name: 'Leisure', subcategories: ['Restaurant'] },
      ],
      orphanSubcategories: ['Streaming'],
      subcategoryColumnMapped: true,
    });
  });

  it('handles omitted, undefined, and null previous payloads', () => {
    const state: CategoryOnboardingState = {
      categories: [],
      orphanSubcategories: [],
      subcategoryColumnMapped: false,
    };

    expect(serializeCategoryOnboardingState(state)).toEqual(state);
    expect(serializeCategoryOnboardingState(state, undefined)).toEqual(state);
    expect(serializeCategoryOnboardingState(state, null)).toEqual(state);
  });
});

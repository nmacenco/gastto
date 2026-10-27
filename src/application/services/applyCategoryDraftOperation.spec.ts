import { describe, expect, it } from 'vitest';
import type { VocabularySnapshot } from '../ports/SettingsVocabularyCommit';
import { applyCategoryDraftOperation } from './applyCategoryDraftOperation';

const spreadsheetId = '11111111-1111-4111-8111-111111111111';
const foodId = '22222222-2222-4222-8222-222222222222';
const childId = '33333333-3333-4333-8333-333333333333';
const inactiveId = '44444444-4444-4444-8444-444444444444';
const source = (): VocabularySnapshot => ({
  categories: [
    { id: foodId, name: 'Comida', normalizedName: 'comida', isActive: true },
    { id: inactiveId, name: 'Ocio', normalizedName: 'ocio', isActive: false },
  ],
  subcategories: [
    { id: childId, categoryId: foodId, name: 'Café', normalizedName: 'café', isActive: true },
  ],
});

describe('settings category draft operations', () => {
  it('renames a parent while preserving child references and source', () => {
    const original = source();
    const result = applyCategoryDraftOperation(original, spreadsheetId, {
      kind: 'rename',
      from: 'Comida',
      to: 'Alimentos',
    });
    expect(result.categories[0]).toMatchObject({ id: foodId, name: 'Alimentos' });
    expect(result.subcategories[0]).toMatchObject({
      id: childId,
      categoryId: foodId,
      isActive: true,
    });
    expect(original.categories[0]?.name).toBe('Comida');
  });

  it('reactivates an inactive category without restoring children', () => {
    const original = source();
    original.subcategories.push({
      id: '55555555-5555-4555-8555-555555555555',
      categoryId: inactiveId,
      name: 'Cine',
      normalizedName: 'cine',
      isActive: false,
    });
    const result = applyCategoryDraftOperation(original, spreadsheetId, {
      kind: 'add',
      name: 'Ocio',
    });
    expect(result.categories.find((row) => row.id === inactiveId)?.isActive).toBe(true);
    expect(result.subcategories.at(-1)?.isActive).toBe(false);
  });

  it('rejects rename into an inactive reserved identity', () => {
    expect(() =>
      applyCategoryDraftOperation(source(), spreadsheetId, {
        kind: 'rename',
        from: 'Comida',
        to: 'Ocio',
      }),
    ).toThrow(/pertenece/);
  });

  it('deactivates the complete branch and preserves stable ids', () => {
    const result = applyCategoryDraftOperation(source(), spreadsheetId, {
      kind: 'remove',
      name: 'Comida',
    });
    expect(result.categories[0]).toMatchObject({ id: foodId, isActive: false });
    expect(result.subcategories[0]).toMatchObject({ id: childId, isActive: false });
  });

  it('rejects moving a child into an inactive reserved child name', () => {
    const original = source();
    original.categories.find((row) => row.id === inactiveId)!.isActive = true;
    original.subcategories.push({
      id: '55555555-5555-4555-8555-555555555555',
      categoryId: inactiveId,
      name: 'Café',
      normalizedName: 'café',
      isActive: false,
    });
    expect(() =>
      applyCategoryDraftOperation(original, spreadsheetId, {
        kind: 'move-subcategory',
        name: 'Café',
        fromParent: 'Comida',
        toParent: 'Ocio',
      }),
    ).toThrow(/pertenece/);
    expect(original.subcategories[0]?.categoryId).toBe(foodId);
  });

  it('rejects child commands without an active parent', () => {
    expect(() =>
      applyCategoryDraftOperation(source(), spreadsheetId, {
        kind: 'add-subcategory',
        name: 'Cine',
        parent: 'Ocio',
      }),
    ).toThrow(/No existe/);
  });
});

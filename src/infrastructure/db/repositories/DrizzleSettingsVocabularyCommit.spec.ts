import { describe, expect, it } from 'vitest';
import type {
  PaymentSnapshot,
  VocabularySnapshot,
} from '../../../application/ports/SettingsVocabularyCommit';
import { samePayments, sameSnapshot } from './DrizzleSettingsVocabularyCommit';

const categoryId = '33333333-3333-4333-8333-333333333333';
const childId = '44444444-4444-4444-8444-444444444444';

describe('settings vocabulary snapshot comparison', () => {
  it('accepts an unchanged category baseline after JSONB reorders object keys', () => {
    const expected: VocabularySnapshot = {
      categories: [{ id: categoryId, name: 'Seguros', normalizedName: 'seguros', isActive: true }],
      subcategories: [
        {
          id: childId,
          categoryId,
          name: 'Hogar',
          normalizedName: 'hogar',
          isActive: true,
        },
      ],
    };
    const stored: VocabularySnapshot = {
      categories: [{ isActive: true, normalizedName: 'seguros', name: 'Seguros', id: categoryId }],
      subcategories: [
        {
          normalizedName: 'hogar',
          name: 'Hogar',
          isActive: true,
          id: childId,
          categoryId,
        },
      ],
    };

    expect(sameSnapshot(stored, expected)).toBe(true);
    const vidaId = '55555555-5555-4555-8555-555555555555';
    const draft: VocabularySnapshot = {
      ...expected,
      subcategories: [
        ...expected.subcategories,
        { id: vidaId, categoryId, name: 'Vida', normalizedName: 'vida', isActive: true },
      ],
    };
    const storedDraft: VocabularySnapshot = {
      ...stored,
      subcategories: [
        ...stored.subcategories,
        { normalizedName: 'vida', name: 'Vida', isActive: true, id: vidaId, categoryId },
      ],
    };
    expect(sameSnapshot(storedDraft, draft)).toBe(true);
    expect(
      sameSnapshot(stored, {
        ...expected,
        subcategories: [{ ...expected.subcategories[0]!, name: 'Vida', normalizedName: 'vida' }],
      }),
    ).toBe(false);
  });

  it('accepts an unchanged payment baseline after JSONB reorders object keys', () => {
    const expected: PaymentSnapshot = {
      confirmed: true,
      methods: [{ id: childId, name: 'Visa', normalizedName: 'visa', isActive: true }],
    };
    const stored: PaymentSnapshot = {
      methods: [{ isActive: true, normalizedName: 'visa', name: 'Visa', id: childId }],
      confirmed: true,
    };

    expect(samePayments(stored, expected)).toBe(true);
    expect(samePayments(stored, { ...expected, confirmed: false })).toBe(false);
  });
});

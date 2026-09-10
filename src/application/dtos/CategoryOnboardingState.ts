// LAYER: Application
// Canonical, backward-compatible payload for the ONBOARDING_CATEGORIES state.

import { z } from 'zod';
import { CategoryVocabulary } from '../../domain/entities/CategoryVocabulary';
import { DomainValidationError } from '../../domain/errors/DomainValidationError';

export const CategoryOnboardingCategorySchema = z
  .object({
    name: z.string().trim().min(1),
    subcategories: z.array(z.string().trim().min(1)),
  })
  .strict();

export type CategoryOnboardingCategory = z.infer<typeof CategoryOnboardingCategorySchema>;

export const CategoryOnboardingStateSchema = z.object({
  categories: z.array(CategoryOnboardingCategorySchema),
  orphanSubcategories: z.array(z.string().trim().min(1)),
  subcategoryColumnMapped: z.boolean(),
});

export type CategoryOnboardingState = z.infer<typeof CategoryOnboardingStateSchema>;

const LegacyCategoryOnboardingStateSchema = z.object({
  categories: z.array(z.string().trim().min(1)),
});

const PAYLOAD_VOCABULARY_ID = 'category-onboarding-state';

export function parseCategoryOnboardingState(payload: unknown): CategoryOnboardingState | null {
  const canonical = CategoryOnboardingStateSchema.safeParse(payload);
  if (canonical.success) {
    return normalizeState(canonical.data);
  }

  if (
    isRecord(payload) &&
    ('orphanSubcategories' in payload || 'subcategoryColumnMapped' in payload)
  ) {
    return null;
  }

  const legacy = LegacyCategoryOnboardingStateSchema.safeParse(payload);
  if (!legacy.success) return null;

  return normalizeState({
    categories: legacy.data.categories.map((name) => ({ name, subcategories: [] })),
    orphanSubcategories: [],
    subcategoryColumnMapped: false,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function serializeCategoryOnboardingState(
  state: CategoryOnboardingState,
  previousPayload?: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    ...(previousPayload ?? {}),
    categories: state.categories.map((category) => ({
      name: category.name,
      subcategories: [...category.subcategories],
    })),
    orphanSubcategories: [...state.orphanSubcategories],
    subcategoryColumnMapped: state.subcategoryColumnMapped,
  };
}

function normalizeState(state: CategoryOnboardingState): CategoryOnboardingState {
  const vocabulary = new CategoryVocabulary(PAYLOAD_VOCABULARY_ID);

  for (const categoryNode of state.categories) {
    const category = addOrGetCategory(vocabulary, categoryNode.name);
    for (const subcategory of categoryNode.subcategories) {
      try {
        vocabulary.addSubcategory(category.id, subcategory);
      } catch (error) {
        if (!(error instanceof DomainValidationError)) throw error;
      }
    }
  }

  return {
    categories: vocabulary.getCategories().map((category) => ({
      name: category.name,
      subcategories: vocabulary
        .getSubcategories(category.id)
        .map((subcategory) => subcategory.name),
    })),
    orphanSubcategories: deduplicateNames(state.orphanSubcategories),
    subcategoryColumnMapped: state.subcategoryColumnMapped,
  };
}

function addOrGetCategory(vocabulary: CategoryVocabulary, name: string) {
  try {
    return vocabulary.addCategory(name);
  } catch (error) {
    if (!(error instanceof DomainValidationError)) throw error;

    const normalizedName = name.trim().toLowerCase();
    const existing = vocabulary
      .getCategories()
      .find((category) => category.normalizedName === normalizedName);
    if (!existing) throw error;
    return existing;
  }
}

function deduplicateNames(names: readonly string[]): string[] {
  const uniqueNames = new Map<string, string>();
  for (const name of names) {
    const trimmed = name.trim();
    const normalized = trimmed.toLowerCase();
    if (!uniqueNames.has(normalized)) uniqueNames.set(normalized, trimmed);
  }
  return [...uniqueNames.values()];
}

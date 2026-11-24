// LAYER: Application
// Canonical, backward-compatible payload for the ONBOARDING_CATEGORIES state.

import { z } from 'zod';
import { createHash } from 'node:crypto';
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
  const payload: Record<string, unknown> = {
    ...(previousPayload ?? {}),
    categories: state.categories.map((category) => ({
      name: category.name,
      subcategories: [...category.subcategories],
    })),
    orphanSubcategories: [...state.orphanSubcategories],
    subcategoryColumnMapped: state.subcategoryColumnMapped,
  };
  if (
    previousPayload?.categoryProposalId !== undefined &&
    categoryProposalFingerprint(previousPayload) !== categoryProposalFingerprint(payload)
  ) {
    payload.categoryPresentation = null;
    payload.categoryAcceptance = null;
  }
  return payload;
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

// Missing metadata is a legacy draft, never evidence of successful delivery.
const CategoryPresentationSchema = z.object({
  proposalId: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  presentedAt: z.string().datetime(),
});
export const CategoryProposalMetadataSchema = z.object({
  categoryProposalId: z.string().min(1).nullable().default(null),
  categoryPresentation: CategoryPresentationSchema.nullable().default(null),
  categoryAcceptance: z
    .object({
      proposalId: z.string().min(1),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .nullable()
    .default(null),
});
export type CategoryProposalMetadata = z.infer<typeof CategoryProposalMetadataSchema>;

export function parseCategoryProposalMetadata(payload: unknown): CategoryProposalMetadata | null {
  const result = CategoryProposalMetadataSchema.safeParse(payload);
  return result.success ? result.data : null;
}

export function categoryProposalFingerprint(payload: Record<string, unknown>): string {
  const state = parseCategoryOnboardingState(payload);
  const binding = {
    state,
    categoryDraft: payload.categoryDraft,
    spreadsheetId: payload.spreadsheetId,
    proposalId: payload.proposalId,
    provider: payload.provider,
    fileId: payload.fileId,
    sheetName: payload.sheetName,
    headerRowIndex: payload.headerRowIndex,
    confirmedMappings: payload.confirmedMappings,
  };
  return createHash('sha256')
    .update(
      JSON.stringify(binding, (_key: string, value: unknown) => {
        if (!isRecord(value)) return value;
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        );
      }),
    )
    .digest('hex');
}

export function isCategoryProposalPresented(payload: Record<string, unknown> | null): boolean {
  if (!payload || !parseCategoryOnboardingState(payload)?.categories.length) return false;
  const metadata = parseCategoryProposalMetadata(payload);
  return (
    metadata !== null &&
    metadata.categoryProposalId !== null &&
    metadata.categoryPresentation?.proposalId === metadata.categoryProposalId &&
    metadata.categoryPresentation.fingerprint === categoryProposalFingerprint(payload)
  );
}

export function isCategoryProposalAccepted(payload: Record<string, unknown> | null): boolean {
  if (!payload || !isCategoryProposalPresented(payload)) return false;
  const metadata = parseCategoryProposalMetadata(payload)!;
  return (
    metadata.categoryAcceptance?.proposalId === metadata.categoryProposalId &&
    metadata.categoryAcceptance?.fingerprint === categoryProposalFingerprint(payload)
  );
}

export const DEFAULT_ONBOARDING_CATEGORIES = [
  'alimentacion',
  'transporte',
  'servicios',
  'ocio',
  'salud',
  'otros',
];

export function mayBeLegacyPlaceholder(state: CategoryOnboardingState): boolean {
  return (
    !state.subcategoryColumnMapped &&
    state.orphanSubcategories.length === 0 &&
    state.categories.length === DEFAULT_ONBOARDING_CATEGORIES.length &&
    state.categories.every(
      (category) =>
        category.subcategories.length === 0 &&
        DEFAULT_ONBOARDING_CATEGORIES.includes(category.name.toLowerCase()),
    )
  );
}

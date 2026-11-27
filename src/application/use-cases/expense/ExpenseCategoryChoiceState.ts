import {
  normalizeExpenseReviewPayload,
  type ExpenseReviewPayload,
} from '../../../domain/value-objects/expense-review-payload';
import type { VocabularySnapshot } from '../../ports/SettingsVocabularyCommit';

export interface ExpenseCategoryChoiceState {
  _type: 'ExpenseCategoryChoice';
  kind: 'category' | 'subcategory';
  choiceId: string;
  stage: 'choose' | 'confirm';
  attemptedName: string;
  suggestedName: string | null;
  parentCategoryId: string | null;
  parentCategoryName: string | null;
  subcategoryColumnMapped: boolean;
  sourceConfigId: string;
  baseline: VocabularySnapshot;
  original: ExpenseReviewPayload;
  proposed: ExpenseReviewPayload;
  correctionCycles: number;
}

export function parseExpenseCategoryChoice(value: unknown): ExpenseCategoryChoiceState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data._type !== 'ExpenseCategoryChoice') return null;
  const kind = data.kind === undefined ? 'category' : data.kind;
  if (kind !== 'category' && kind !== 'subcategory') return null;
  if (
    typeof data.choiceId !== 'string' ||
    !data.choiceId ||
    (data.stage !== 'choose' && data.stage !== 'confirm') ||
    typeof data.attemptedName !== 'string' ||
    !data.attemptedName.trim() ||
    (data.suggestedName !== null && typeof data.suggestedName !== 'string') ||
    typeof data.sourceConfigId !== 'string' ||
    !data.sourceConfigId ||
    typeof data.correctionCycles !== 'number' ||
    !Number.isInteger(data.correctionCycles) ||
    data.correctionCycles < 0
  )
    return null;
  if (
    (kind === 'subcategory' &&
      (typeof data.parentCategoryId !== 'string' ||
        !data.parentCategoryId ||
        typeof data.parentCategoryName !== 'string' ||
        !data.parentCategoryName ||
        typeof data.subcategoryColumnMapped !== 'boolean')) ||
    (kind === 'category' &&
      ((data.parentCategoryId !== undefined && data.parentCategoryId !== null) ||
        (data.parentCategoryName !== undefined && data.parentCategoryName !== null)))
  )
    return null;
  const baseline = data.baseline as VocabularySnapshot;
  if (!baseline || !Array.isArray(baseline.categories) || !Array.isArray(baseline.subcategories))
    return null;
  if (
    !baseline.categories.every(
      (row) =>
        row &&
        typeof row.id === 'string' &&
        typeof row.name === 'string' &&
        typeof row.normalizedName === 'string' &&
        typeof row.isActive === 'boolean',
    )
  )
    return null;
  if (
    !baseline.subcategories.every(
      (row) =>
        row &&
        typeof row.id === 'string' &&
        typeof row.categoryId === 'string' &&
        typeof row.name === 'string' &&
        typeof row.normalizedName === 'string' &&
        typeof row.isActive === 'boolean',
    )
  )
    return null;
  try {
    return {
      _type: 'ExpenseCategoryChoice',
      kind,
      choiceId: data.choiceId,
      stage: data.stage,
      attemptedName: data.attemptedName,
      suggestedName: data.suggestedName,
      parentCategoryId: kind === 'subcategory' ? (data.parentCategoryId as string) : null,
      parentCategoryName: kind === 'subcategory' ? (data.parentCategoryName as string) : null,
      subcategoryColumnMapped:
        kind === 'subcategory' ? (data.subcategoryColumnMapped as boolean) : false,
      sourceConfigId: data.sourceConfigId,
      baseline,
      original: normalizeExpenseReviewPayload(data.original),
      proposed: normalizeExpenseReviewPayload(data.proposed),
      correctionCycles: data.correctionCycles,
    };
  } catch {
    return null;
  }
}

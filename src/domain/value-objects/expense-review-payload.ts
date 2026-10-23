// LAYER: Domain
// Payload shape for the EXPENSE_REVIEW FSM state.
// Defined in the Domain layer so it can be reused by Domain value objects
// (e.g. ExpenseCorrectionState) and by Application/Interface layers without
// violating the Clean Architecture dependency rule.

import type { CategoryConfidence, ExtractedExpense } from '../entities/ExpenseRecord';
import type { Currency } from '../entities/User';
import { DomainValidationError } from '../errors/DomainValidationError';
import { normalizeExpenseReviewBinding, type ExpenseReviewBinding } from './expense-review-binding';

export interface ExpenseReviewPayload {
  extracted: ExtractedExpense;
  rawMessage: string;
  resolvedDate: string; // ISO date string
  resolvedCategory: string | null;
  resolvedCategoryId: string | null;
  categoryStatus: 'confirmed' | 'ambiguous' | 'fallback' | 'none';
  /**
   * Optional for persisted-payload compatibility. New registration payloads
   * always set the four hierarchy fields explicitly; missing fields represent
   * a legacy, hierarchy-disabled review at presentation time.
   */
  resolvedSubcategory?: string | null;
  resolvedSubcategoryId?: string | null;
  subcategoryStatus?: 'confirmed' | 'ambiguous' | 'fallback' | 'none';
  subcategoryEnabled?: boolean;
  awaitingZeroConfirmation?: boolean;
  reminderSent?: boolean;
  pendingHighAmountConfirmation?: boolean;
  /** Number of expenses already saved in the current queued batch. */
  queueRegisteredCount?: number;
  immediateUndoExpenseId?: string;
  /** Null only for legacy reviews that must be persisted and re-presented before authorization. */
  reviewBinding?: ExpenseReviewBinding | null;
}

export type ExpenseReviewCategoryStatus = ExpenseReviewPayload['categoryStatus'];

const VALID_CONFIDENCE: readonly CategoryConfidence[] = ['alta', 'baja', 'nula'];
const VALID_CURRENCIES: readonly Currency[] = ['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL'];
const VALID_CATEGORY_STATUS: readonly ExpenseReviewCategoryStatus[] = [
  'confirmed',
  'ambiguous',
  'fallback',
  'none',
];

export type NormalizedExpenseReviewPayload = ExpenseReviewPayload & {
  resolvedSubcategory: string | null;
  resolvedSubcategoryId: string | null;
  subcategoryStatus: ExpenseReviewCategoryStatus;
  subcategoryEnabled: boolean;
  reviewBinding?: ExpenseReviewBinding | null;
};

export function normalizeExtractedExpensePayload(value: unknown): ExtractedExpense {
  if (!isPlainObject(value)) {
    throw new DomainValidationError('extracted expense must be an object');
  }

  const subcategoriaRaw = value.subcategoriaRaw === undefined ? null : value.subcategoriaRaw;
  const confianzaSubcategoria =
    value.confianzaSubcategoria === undefined ? 'nula' : value.confianzaSubcategoria;

  if (value.monto !== null && (typeof value.monto !== 'number' || !Number.isFinite(value.monto))) {
    throw new DomainValidationError('extracted expense monto must be a finite number or null');
  }
  if (value.moneda !== null && !VALID_CURRENCIES.includes(value.moneda as Currency)) {
    throw new DomainValidationError('extracted expense moneda must be a valid currency or null');
  }
  for (const [field, fieldValue] of [
    ['categoriaRaw', value.categoriaRaw],
    ['subcategoriaRaw', subcategoriaRaw],
    ['fechaRaw', value.fechaRaw],
    ['medioPago', value.medioPago],
  ] as const) {
    if (fieldValue !== null && typeof fieldValue !== 'string') {
      throw new DomainValidationError(`extracted expense ${field} must be a string or null`);
    }
  }
  if (!VALID_CONFIDENCE.includes(value.confianzaCategoria as CategoryConfidence)) {
    throw new DomainValidationError('extracted expense confianzaCategoria is invalid');
  }
  if (!VALID_CONFIDENCE.includes(confianzaSubcategoria as CategoryConfidence)) {
    throw new DomainValidationError('extracted expense confianzaSubcategoria is invalid');
  }

  return {
    monto: value.monto,
    moneda: value.moneda as Currency | null,
    categoriaRaw: value.categoriaRaw as string | null,
    subcategoriaRaw: subcategoriaRaw as string | null,
    fechaRaw: value.fechaRaw as string | null,
    medioPago: value.medioPago as string | null,
    confianzaCategoria: value.confianzaCategoria as CategoryConfidence,
    confianzaSubcategoria: confianzaSubcategoria as CategoryConfidence,
  };
}

export function normalizeExpenseReviewPayload(value: unknown): NormalizedExpenseReviewPayload {
  if (!isPlainObject(value)) {
    throw new DomainValidationError('expense review payload must be an object');
  }

  const extracted = normalizeExtractedExpensePayload(value.extracted);
  const resolvedSubcategory =
    value.resolvedSubcategory === undefined ? null : value.resolvedSubcategory;
  const resolvedSubcategoryId =
    value.resolvedSubcategoryId === undefined ? null : value.resolvedSubcategoryId;
  const subcategoryStatus =
    value.subcategoryStatus === undefined ? 'none' : value.subcategoryStatus;
  const subcategoryEnabled =
    value.subcategoryEnabled === undefined ? false : value.subcategoryEnabled;
  const reviewBinding =
    value.reviewBinding === undefined || value.reviewBinding === null
      ? null
      : normalizeExpenseReviewBinding(value.reviewBinding);

  if (typeof value.rawMessage !== 'string' || value.rawMessage.trim().length === 0) {
    throw new DomainValidationError('expense review rawMessage must be a non-empty string');
  }
  if (typeof value.resolvedDate !== 'string' || value.resolvedDate.trim().length === 0) {
    throw new DomainValidationError('expense review resolvedDate must be a non-empty string');
  }
  if (value.resolvedCategory !== null && typeof value.resolvedCategory !== 'string') {
    throw new DomainValidationError('expense review resolvedCategory must be a string or null');
  }
  if (value.resolvedCategoryId !== null && typeof value.resolvedCategoryId !== 'string') {
    throw new DomainValidationError('expense review resolvedCategoryId must be a string or null');
  }
  if (!VALID_CATEGORY_STATUS.includes(value.categoryStatus as ExpenseReviewCategoryStatus)) {
    throw new DomainValidationError('expense review categoryStatus is invalid');
  }
  if (resolvedSubcategory !== null && typeof resolvedSubcategory !== 'string') {
    throw new DomainValidationError('expense review resolvedSubcategory must be a string or null');
  }
  if (resolvedSubcategoryId !== null && typeof resolvedSubcategoryId !== 'string') {
    throw new DomainValidationError(
      'expense review resolvedSubcategoryId must be a string or null',
    );
  }
  if (!VALID_CATEGORY_STATUS.includes(subcategoryStatus as ExpenseReviewCategoryStatus)) {
    throw new DomainValidationError('expense review subcategoryStatus is invalid');
  }
  if (typeof subcategoryEnabled !== 'boolean') {
    throw new DomainValidationError('expense review subcategoryEnabled must be a boolean');
  }

  validateOptionalBoolean(value, 'awaitingZeroConfirmation');
  validateOptionalBoolean(value, 'reminderSent');
  validateOptionalBoolean(value, 'pendingHighAmountConfirmation');
  validateOptionalNonNegativeInteger(value, 'queueRegisteredCount');
  if (
    value.immediateUndoExpenseId !== undefined &&
    (typeof value.immediateUndoExpenseId !== 'string' || value.immediateUndoExpenseId.length === 0)
  ) {
    throw new DomainValidationError(
      'expense review immediateUndoExpenseId must be a non-empty string when provided',
    );
  }

  const hasSelectedSubcategory =
    resolvedSubcategory !== null ||
    resolvedSubcategoryId !== null ||
    subcategoryStatus !== 'none' ||
    extracted.subcategoriaRaw !== null ||
    extracted.confianzaSubcategoria !== 'nula';
  if (!subcategoryEnabled && hasSelectedSubcategory) {
    throw new DomainValidationError('disabled hierarchy cannot expose a selected subcategory');
  }
  if (
    hasSelectedSubcategory &&
    (value.resolvedCategory === null ||
      resolvedSubcategory === null ||
      resolvedSubcategoryId === null)
  ) {
    throw new DomainValidationError(
      'a selected subcategory requires a resolved category, name, and identifier',
    );
  }
  if (
    !hasSelectedSubcategory &&
    (resolvedSubcategory !== null ||
      resolvedSubcategoryId !== null ||
      subcategoryStatus !== 'none' ||
      extracted.subcategoriaRaw !== null ||
      extracted.confianzaSubcategoria !== 'nula')
  ) {
    throw new DomainValidationError('no-child review values must use canonical empty defaults');
  }

  return {
    extracted,
    rawMessage: value.rawMessage,
    resolvedDate: value.resolvedDate,
    resolvedCategory: value.resolvedCategory,
    resolvedCategoryId: value.resolvedCategoryId,
    categoryStatus: value.categoryStatus as ExpenseReviewCategoryStatus,
    resolvedSubcategory,
    resolvedSubcategoryId,
    subcategoryStatus: subcategoryStatus as ExpenseReviewCategoryStatus,
    subcategoryEnabled,
    ...(value.reviewBinding === undefined ? {} : { reviewBinding }),
    ...(value.awaitingZeroConfirmation === undefined
      ? {}
      : { awaitingZeroConfirmation: value.awaitingZeroConfirmation as boolean }),
    ...(value.reminderSent === undefined ? {} : { reminderSent: value.reminderSent as boolean }),
    ...(value.pendingHighAmountConfirmation === undefined
      ? {}
      : { pendingHighAmountConfirmation: value.pendingHighAmountConfirmation as boolean }),
    ...(value.queueRegisteredCount === undefined
      ? {}
      : { queueRegisteredCount: value.queueRegisteredCount as number }),
    ...(value.immediateUndoExpenseId === undefined
      ? {}
      : { immediateUndoExpenseId: value.immediateUndoExpenseId }),
  };
}

export function tryNormalizeExpenseReviewPayload(
  value: unknown,
): NormalizedExpenseReviewPayload | null {
  try {
    return normalizeExpenseReviewPayload(value);
  } catch {
    return null;
  }
}

function validateOptionalBoolean(value: Record<string, unknown>, field: string): void {
  if (value[field] !== undefined && typeof value[field] !== 'boolean') {
    throw new DomainValidationError(`expense review ${field} must be a boolean when provided`);
  }
}

function validateOptionalNonNegativeInteger(value: Record<string, unknown>, field: string): void {
  const fieldValue = value[field];
  if (
    fieldValue !== undefined &&
    (typeof fieldValue !== 'number' || !Number.isInteger(fieldValue) || fieldValue < 0)
  ) {
    throw new DomainValidationError(
      `expense review ${field} must be a non-negative integer when provided`,
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

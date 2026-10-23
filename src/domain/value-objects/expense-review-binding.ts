// LAYER: Domain
// Durable identity for the exact expense review version shown to the user.

import { randomBytes } from 'node:crypto';
import { DomainValidationError } from '../errors/DomainValidationError';

export interface ExpenseReviewBinding {
  readonly operationId: string;
  readonly revision: number;
  readonly presentedAt: string | null;
}

const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function createExpenseReviewBinding(): ExpenseReviewBinding {
  return {
    operationId: randomBytes(16).toString('base64url'),
    revision: 1,
    presentedAt: null,
  };
}

export function advanceExpenseReviewBinding(
  current: ExpenseReviewBinding | null | undefined,
): ExpenseReviewBinding {
  if (current === null || current === undefined || current.revision === Number.MAX_SAFE_INTEGER) {
    return createExpenseReviewBinding();
  }
  return { operationId: current.operationId, revision: current.revision + 1, presentedAt: null };
}

export function normalizeExpenseReviewBinding(value: unknown): ExpenseReviewBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DomainValidationError('expense review binding must be an object');
  }
  const binding = value as Record<string, unknown>;
  const keys = Object.keys(binding);
  if (
    keys.some((key) => !['operationId', 'revision', 'presentedAt'].includes(key)) ||
    keys.length !== 3
  ) {
    throw new DomainValidationError('expense review binding has unexpected fields');
  }
  if (typeof binding.operationId !== 'string' || !OPERATION_ID_PATTERN.test(binding.operationId)) {
    throw new DomainValidationError('expense review operationId is invalid');
  }
  if (
    typeof binding.revision !== 'number' ||
    !Number.isSafeInteger(binding.revision) ||
    binding.revision < 1
  ) {
    throw new DomainValidationError('expense review revision must be a positive safe integer');
  }
  if (
    binding.presentedAt !== null &&
    (typeof binding.presentedAt !== 'string' || !isIsoTimestamp(binding.presentedAt))
  ) {
    throw new DomainValidationError('expense review presentedAt must be an ISO timestamp or null');
  }
  return {
    operationId: binding.operationId,
    revision: binding.revision,
    presentedAt: binding.presentedAt,
  };
}

export function isExpenseReviewOperationId(value: string): boolean {
  return OPERATION_ID_PATTERN.test(value);
}

function isIsoTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

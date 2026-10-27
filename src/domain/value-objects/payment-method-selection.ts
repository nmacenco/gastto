import { DomainValidationError } from '../errors/DomainValidationError';

export type PaymentMethodSelection =
  | {
      status: 'legacy';
      sourceConfigId: string | null;
      paymentMethodId: null;
      canonicalName: string | null;
      unresolvedRaw: null;
    }
  | {
      status: 'none';
      sourceConfigId: string;
      paymentMethodId: null;
      canonicalName: null;
      unresolvedRaw: null;
    }
  | {
      status: 'matched';
      sourceConfigId: string;
      paymentMethodId: string;
      canonicalName: string;
      unresolvedRaw: null;
    }
  | {
      status: 'unresolved';
      sourceConfigId: string;
      paymentMethodId: null;
      canonicalName: null;
      unresolvedRaw: string;
    };

export function normalizePaymentMethodSelection(
  value: unknown,
  legacyRaw: string | null,
): PaymentMethodSelection {
  if (value === undefined)
    return {
      status: 'legacy',
      sourceConfigId: null,
      paymentMethodId: null,
      canonicalName: legacyRaw,
      unresolvedRaw: null,
    };
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DomainValidationError('payment method selection must be an object');
  const selection = value as Record<string, unknown>;
  const id = selection.sourceConfigId;
  if (
    selection.status === 'legacy' &&
    (id === null || typeof id === 'string') &&
    selection.paymentMethodId === null &&
    (selection.canonicalName === null || typeof selection.canonicalName === 'string') &&
    selection.unresolvedRaw === null
  )
    return selection as PaymentMethodSelection;
  if (typeof id !== 'string' || !id)
    throw new DomainValidationError('payment method selection requires a destination');
  if (
    selection.status === 'none' &&
    selection.paymentMethodId === null &&
    selection.canonicalName === null &&
    selection.unresolvedRaw === null
  )
    return selection as PaymentMethodSelection;
  if (
    selection.status === 'matched' &&
    typeof selection.paymentMethodId === 'string' &&
    selection.paymentMethodId &&
    typeof selection.canonicalName === 'string' &&
    selection.canonicalName.trim() &&
    selection.unresolvedRaw === null
  )
    return selection as PaymentMethodSelection;
  if (
    selection.status === 'unresolved' &&
    selection.paymentMethodId === null &&
    selection.canonicalName === null &&
    typeof selection.unresolvedRaw === 'string' &&
    selection.unresolvedRaw.trim()
  )
    return selection as PaymentMethodSelection;
  throw new DomainValidationError('payment method selection is contradictory');
}

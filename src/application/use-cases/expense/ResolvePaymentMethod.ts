import {
  normalizePaymentMethodName,
  type PaymentMethodCatalog,
} from '../../../domain/entities/PaymentMethodCatalog';
import type { PaymentMethodSelection } from '../../../domain/value-objects/payment-method-selection';

export type { PaymentMethodSelection } from '../../../domain/value-objects/payment-method-selection';

export class ResolvePaymentMethod {
  execute({
    catalog,
    rawValue,
    sourceConfigId,
  }: {
    catalog: PaymentMethodCatalog | null;
    rawValue: string | null;
    sourceConfigId: string;
  }): PaymentMethodSelection {
    const trimmed = rawValue?.trim() || null;
    if (catalog === null)
      return {
        status: 'legacy',
        sourceConfigId,
        paymentMethodId: null,
        canonicalName: trimmed,
        unresolvedRaw: null,
      };
    if (catalog.spreadsheetId !== sourceConfigId)
      throw new Error('Payment catalog destination mismatch');
    if (!trimmed)
      return {
        status: 'none',
        sourceConfigId,
        paymentMethodId: null,
        canonicalName: null,
        unresolvedRaw: null,
      };
    const method = catalog
      .getActive()
      .find((entry) => entry.normalizedName === normalizePaymentMethodName(trimmed));
    return method
      ? {
          status: 'matched',
          sourceConfigId,
          paymentMethodId: method.id,
          canonicalName: method.name,
          unresolvedRaw: null,
        }
      : {
          status: 'unresolved',
          sourceConfigId,
          paymentMethodId: null,
          canonicalName: null,
          unresolvedRaw: trimmed,
        };
  }
}

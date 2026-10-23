// LAYER: Domain
// Immutable value object representing a non-negative amount of money in a specific currency.

import type { Currency as CurrencyCode } from '../entities/User';
import { DomainValidationError } from '../errors/DomainValidationError';

export class Money {
  readonly amount: number;
  readonly currency: CurrencyCode;

  constructor(amount: number, currency: CurrencyCode) {
    if (!Number.isFinite(amount)) {
      throw new DomainValidationError('amount must be a finite number');
    }
    if (amount < 0) {
      throw new DomainValidationError('amount must be non-negative');
    }

    this.amount = amount;
    this.currency = currency;
    Object.freeze(this);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }
}

import { randomUUID } from 'node:crypto';
import { DomainValidationError } from '../errors/DomainValidationError';

export interface PaymentMethod {
  id: string;
  name: string;
  normalizedName: string;
  isActive: boolean;
}

export const normalizePaymentMethodName = (name: string): string => name.trim().toLowerCase();

export class PaymentMethodCatalog {
  private methods: PaymentMethod[];

  constructor(
    public readonly spreadsheetId: string,
    methods: PaymentMethod[] = [],
  ) {
    this.methods = methods.map((method) => ({ ...method }));
    this.validate();
  }

  getMethods(): readonly PaymentMethod[] {
    return this.methods.map((method) => ({ ...method }));
  }

  getActive(): readonly PaymentMethod[] {
    return this.getMethods().filter((method) => method.isActive);
  }

  add(name: string): PaymentMethod {
    const trimmed = name.trim();
    const normalizedName = normalizePaymentMethodName(name);
    if (!normalizedName) throw new DomainValidationError('Payment method name cannot be empty');
    const existing = this.methods.find((method) => method.normalizedName === normalizedName);
    if (existing) {
      if (existing.isActive)
        throw new DomainValidationError(`Payment method "${trimmed}" already exists`);
      existing.isActive = true;
      existing.name = trimmed;
      return { ...existing };
    }
    const method = { id: randomUUID(), name: trimmed, normalizedName, isActive: true };
    this.methods.push(method);
    return { ...method };
  }

  rename(id: string, name: string): PaymentMethod {
    const method = this.requireActive(id);
    const trimmed = name.trim();
    const normalizedName = normalizePaymentMethodName(name);
    if (!normalizedName) throw new DomainValidationError('Payment method name cannot be empty');
    if (this.methods.some((other) => other.id !== id && other.normalizedName === normalizedName))
      throw new DomainValidationError(`Payment method "${trimmed}" is reserved`);
    method.name = trimmed;
    method.normalizedName = normalizedName;
    return { ...method };
  }

  deactivate(id: string): void {
    this.requireActive(id).isActive = false;
  }

  private requireActive(id: string): PaymentMethod {
    const method = this.methods.find((entry) => entry.id === id && entry.isActive);
    if (!method) throw new DomainValidationError(`Active payment method "${id}" not found`);
    return method;
  }

  private validate(): void {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const method of this.methods) {
      if (
        !method.name.trim() ||
        normalizePaymentMethodName(method.name) !== method.normalizedName ||
        ids.has(method.id) ||
        names.has(method.normalizedName)
      )
        throw new DomainValidationError('Invalid payment method catalog');
      ids.add(method.id);
      names.add(method.normalizedName);
    }
  }
}

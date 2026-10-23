// LAYER: Domain
// Immutable value object representing a single category in the user's vocabulary.

import { DomainValidationError } from '../errors/DomainValidationError';

export interface CategoryProps {
  name: string;
  displayLabel?: string | null | undefined;
  order?: number | null | undefined;
}

export class Category {
  private constructor(
    public readonly name: string,
    public readonly displayLabel: string | null,
    public readonly order: number,
  ) {}

  static create(props: CategoryProps): Category {
    const trimmedName = props.name.trim();
    if (trimmedName.length === 0) {
      throw new DomainValidationError('Category name cannot be empty');
    }

    const displayLabel =
      props.displayLabel === undefined || props.displayLabel === null
        ? null
        : props.displayLabel.trim() || null;

    return new Category(trimmedName, displayLabel, props.order ?? 0);
  }

  get normalizedName(): string {
    return normalizeCategoryName(this.name);
  }
}

export function normalizeCategoryName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

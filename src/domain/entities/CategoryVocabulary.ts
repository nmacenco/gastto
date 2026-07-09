// LAYER: Domain
// CategoryVocabulary aggregate root — enforces invariants across the
// set of categories belonging to a single spreadsheet.

import { randomUUID } from 'node:crypto';
import type { Category } from './Category';
import { DomainValidationError } from '../errors/DomainValidationError';

export class CategoryVocabulary {
  constructor(
    public readonly spreadsheetId: string,
    private categories: Category[] = [],
  ) {}

  getCategories(): readonly Category[] {
    return this.categories;
  }

  addCategory(name: string): Category {
    const trimmed = name.trim();
    const normalized = trimmed.toLowerCase();

    if (normalized.length === 0) {
      throw new DomainValidationError('Category name cannot be empty');
    }

    if (this.categories.some((c) => c.normalizedName === normalized)) {
      throw new DomainValidationError(`Category "${trimmed}" already exists`);
    }

    const category: Category = {
      id: randomUUID(),
      name: trimmed,
      normalizedName: normalized,
    };

    this.categories = [...this.categories, category];
    return category;
  }

  removeCategory(id: string): void {
    this.categories = this.categories.filter((c) => c.id !== id);
  }

  renameCategory(id: string, newName: string): Category {
    const trimmed = newName.trim();
    const normalized = trimmed.toLowerCase();

    if (normalized.length === 0) {
      throw new DomainValidationError('Category name cannot be empty');
    }

    const duplicate = this.categories.find((c) => c.id !== id && c.normalizedName === normalized);
    if (duplicate) {
      throw new DomainValidationError(`Category "${trimmed}" already exists`);
    }

    this.categories = this.categories.map((c) =>
      c.id === id ? { ...c, name: trimmed, normalizedName: normalized } : c,
    );

    const updated = this.categories.find((c) => c.id === id);
    if (!updated) {
      throw new DomainValidationError(`Category with id "${id}" not found`);
    }

    return updated;
  }
}

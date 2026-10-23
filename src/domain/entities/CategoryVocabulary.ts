// LAYER: Domain
// CategoryVocabulary aggregate root — enforces invariants across the
// set of categories belonging to a single spreadsheet.

import { randomUUID } from 'node:crypto';
import type { Category } from './Category';
import type { Subcategory } from './Subcategory';
import { DomainValidationError } from '../errors/DomainValidationError';

export class CategoryVocabulary {
  constructor(
    public readonly spreadsheetId: string,
    private categories: Category[] = [],
    private subcategories: Subcategory[] = [],
  ) {
    this.categories = categories.map((category) => ({ ...category }));
    this.subcategories = subcategories.map((subcategory) => ({ ...subcategory }));
  }

  getCategories(): readonly Category[] {
    return this.categories.map((category) => ({ ...category }));
  }

  getSubcategories(categoryId?: string): readonly Subcategory[] {
    const subcategories =
      categoryId === undefined
        ? this.subcategories
        : this.subcategories.filter((subcategory) => subcategory.categoryId === categoryId);

    return subcategories.map((subcategory) => ({ ...subcategory }));
  }

  findSubcategory(categoryId: string, name: string): Subcategory | undefined {
    const normalized = this.normalizeName(name);
    const subcategory = this.subcategories.find(
      (candidate) => candidate.categoryId === categoryId && candidate.normalizedName === normalized,
    );

    return subcategory ? { ...subcategory } : undefined;
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
    this.subcategories = this.subcategories.filter((subcategory) => subcategory.categoryId !== id);
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

  addSubcategory(categoryId: string, name: string): Subcategory {
    this.requireCategory(categoryId);
    const trimmed = name.trim();
    const normalized = this.normalizeName(name);

    if (normalized.length === 0) {
      throw new DomainValidationError('Subcategory name cannot be empty');
    }

    if (this.hasSubcategory(categoryId, normalized)) {
      throw new DomainValidationError(`Subcategory "${trimmed}" already exists in category`);
    }

    const subcategory: Subcategory = {
      id: randomUUID(),
      categoryId,
      name: trimmed,
      normalizedName: normalized,
    };

    this.subcategories = [...this.subcategories, subcategory];
    return { ...subcategory };
  }

  renameSubcategory(id: string, newName: string): Subcategory {
    const existing = this.requireSubcategory(id);
    const trimmed = newName.trim();
    const normalized = this.normalizeName(newName);

    if (normalized.length === 0) {
      throw new DomainValidationError('Subcategory name cannot be empty');
    }

    if (this.hasSubcategory(existing.categoryId, normalized, id)) {
      throw new DomainValidationError(`Subcategory "${trimmed}" already exists in category`);
    }

    const updated = { ...existing, name: trimmed, normalizedName: normalized };
    this.subcategories = this.subcategories.map((subcategory) =>
      subcategory.id === id ? updated : subcategory,
    );
    return { ...updated };
  }

  moveSubcategory(id: string, targetCategoryId: string): Subcategory {
    const existing = this.requireSubcategory(id);
    this.requireCategory(targetCategoryId);

    if (this.hasSubcategory(targetCategoryId, existing.normalizedName, id)) {
      throw new DomainValidationError(
        `Subcategory "${existing.name}" already exists in target category`,
      );
    }

    const updated = { ...existing, categoryId: targetCategoryId };
    this.subcategories = this.subcategories.map((subcategory) =>
      subcategory.id === id ? updated : subcategory,
    );
    return { ...updated };
  }

  removeSubcategory(id: string): void {
    this.requireSubcategory(id);
    this.subcategories = this.subcategories.filter((subcategory) => subcategory.id !== id);
  }

  private normalizeName(name: string): string {
    return name.trim().toLowerCase();
  }

  private requireCategory(id: string): Category {
    const category = this.categories.find((candidate) => candidate.id === id);
    if (!category) {
      throw new DomainValidationError(`Category with id "${id}" not found`);
    }
    return category;
  }

  private requireSubcategory(id: string): Subcategory {
    const subcategory = this.subcategories.find((candidate) => candidate.id === id);
    if (!subcategory) {
      throw new DomainValidationError(`Subcategory with id "${id}" not found`);
    }
    return subcategory;
  }

  private hasSubcategory(categoryId: string, normalizedName: string, excludedId?: string): boolean {
    return this.subcategories.some(
      (subcategory) =>
        subcategory.id !== excludedId &&
        subcategory.categoryId === categoryId &&
        subcategory.normalizedName === normalizedName,
    );
  }
}

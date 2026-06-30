// LAYER: Domain
// Immutable value object representing the user's category vocabulary during onboarding.
// Tracks the category list, the current confirmation state, and the source of the data.

import { Category, normalizeCategoryName } from './Category';

export type CategoryVocabularyState = 'detecting' | 'confirming' | 'editing' | 'confirmed';
export type CategoryVocabularySource = 'detected' | 'default' | 'user-edited';

export const DEFAULT_CATEGORY_SET: readonly string[] = [
  'Food',
  'Transportation',
  'Services',
  'Leisure',
  'Health',
  'Others',
];

export interface CategoryVocabularyProps {
  categories: Category[];
  state?: CategoryVocabularyState | null | undefined;
  source?: CategoryVocabularySource | null | undefined;
}

export class CategoryVocabulary {
  private constructor(
    public readonly categories: readonly Category[],
    public readonly state: CategoryVocabularyState,
    public readonly source: CategoryVocabularySource,
  ) {}

  static create(props: CategoryVocabularyProps): CategoryVocabulary {
    return new CategoryVocabulary(
      props.categories,
      props.state ?? 'detecting',
      props.source ?? 'detected',
    );
  }

  static fromDetected(values: string[]): CategoryVocabulary {
    const categories = values.map((name, index) => Category.create({ name, order: index }));
    return new CategoryVocabulary(categories, 'confirming', 'detected');
  }

  static withDefaults(): CategoryVocabulary {
    const categories = DEFAULT_CATEGORY_SET.map((name, index) =>
      Category.create({ name, order: index }),
    );
    return new CategoryVocabulary(categories, 'confirming', 'default');
  }

  confirm(): CategoryVocabulary {
    return new CategoryVocabulary(this.categories, 'confirmed', this.source);
  }

  addCategory(name: string): CategoryVocabulary {
    const normalized = normalizeCategoryName(name);
    if (this.categories.some((category) => normalizeCategoryName(category.name) === normalized)) {
      return this;
    }

    const newCategory = Category.create({ name, order: this.categories.length });
    return new CategoryVocabulary([...this.categories, newCategory], 'editing', 'user-edited');
  }

  removeCategory(name: string): CategoryVocabulary {
    const normalized = normalizeCategoryName(name);
    const filtered = this.categories.filter(
      (category) => normalizeCategoryName(category.name) !== normalized,
    );

    if (filtered.length === this.categories.length) {
      return this;
    }

    return new CategoryVocabulary(filtered, 'editing', 'user-edited');
  }

  renameCategory(from: string, to: string): CategoryVocabulary {
    const fromNormalized = normalizeCategoryName(from);
    const toNormalized = normalizeCategoryName(to);

    const target = this.categories.find(
      (category) => normalizeCategoryName(category.name) === fromNormalized,
    );
    if (!target) {
      return this;
    }

    const wouldDuplicate = this.categories.some(
      (category) =>
        normalizeCategoryName(category.name) === toNormalized &&
        normalizeCategoryName(category.name) !== fromNormalized,
    );
    if (wouldDuplicate) {
      return this;
    }

    const renamed = this.categories.map((category) =>
      normalizeCategoryName(category.name) === fromNormalized
        ? Category.create({
            name: to,
            displayLabel: category.displayLabel,
            order: category.order,
          })
        : category,
    );

    return new CategoryVocabulary(renamed, 'editing', 'user-edited');
  }
}

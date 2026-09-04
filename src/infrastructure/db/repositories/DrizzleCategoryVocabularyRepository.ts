// LAYER: Infrastructure
// Concrete ICategoryVocabularyRepository implementation using Drizzle ORM.
// Maps the complete CategoryVocabulary aggregate to category and subcategory rows.

import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';
import type { ICategoryVocabularyRepository } from '../../../domain/ports/repositories';
import type * as schema from '../schema';
import { userCategories, userSubcategories } from '../schema';

export class DrizzleCategoryVocabularyRepository implements ICategoryVocabularyRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findBySpreadsheetId(spreadsheetId: string): Promise<CategoryVocabulary | null> {
    const categoryRows = await this.db
      .select()
      .from(userCategories)
      .where(
        and(eq(userCategories.spreadsheetId, spreadsheetId), eq(userCategories.isActive, true)),
      );

    if (categoryRows.length === 0) return null;

    const subcategoryRows = await this.db
      .select()
      .from(userSubcategories)
      .where(
        and(
          inArray(
            userSubcategories.categoryId,
            categoryRows.map((row) => row.id),
          ),
          eq(userSubcategories.isActive, true),
        ),
      );

    return new CategoryVocabulary(
      spreadsheetId,
      categoryRows.map((row) => ({
        id: row.id,
        name: row.rawValue,
        normalizedName: row.normalizedValue,
      })),
      subcategoryRows.map((row) => ({
        id: row.id,
        categoryId: row.categoryId,
        name: row.rawValue,
        normalizedName: row.normalizedValue,
      })),
    );
  }

  async save(vocabulary: CategoryVocabulary): Promise<void> {
    await this.db.transaction(async (tx) => {
      const spreadsheetId = vocabulary.spreadsheetId;
      const categories = vocabulary.getCategories();
      const subcategories = vocabulary.getSubcategories();
      const existingCategories = await tx
        .select()
        .from(userCategories)
        .where(eq(userCategories.spreadsheetId, spreadsheetId));
      const existingCategoryIds = existingCategories.map((row) => row.id);
      const existingSubcategories =
        existingCategoryIds.length === 0
          ? []
          : await tx
              .select()
              .from(userSubcategories)
              .where(inArray(userSubcategories.categoryId, existingCategoryIds));

      const categoriesById = new Map(existingCategories.map((row) => [row.id, row]));
      const categoriesByName = new Map(existingCategories.map((row) => [row.normalizedValue, row]));
      const resolvedCategoryIds = new Map<string, string>();
      const desiredPersistedCategoryIds = new Set<string>();

      // Persist and resolve every parent before mutating children. Natural-key
      // conflicts reactivate the persisted row without rewriting its primary key.
      for (const category of categories) {
        const naturalKeyMatch = categoriesByName.get(category.normalizedName);
        const idMatch = categoriesById.get(category.id);

        if (naturalKeyMatch) {
          await tx
            .update(userCategories)
            .set({ rawValue: category.name, isActive: true })
            .where(eq(userCategories.id, naturalKeyMatch.id));
          resolvedCategoryIds.set(category.id, naturalKeyMatch.id);
          desiredPersistedCategoryIds.add(naturalKeyMatch.id);
        } else if (idMatch) {
          await tx
            .update(userCategories)
            .set({
              rawValue: category.name,
              normalizedValue: category.normalizedName,
              isActive: true,
            })
            .where(eq(userCategories.id, idMatch.id));
          resolvedCategoryIds.set(category.id, idMatch.id);
          desiredPersistedCategoryIds.add(idMatch.id);
        } else {
          await tx.insert(userCategories).values({
            id: category.id,
            spreadsheetId,
            rawValue: category.name,
            normalizedValue: category.normalizedName,
            usageCount: 0,
            isActive: true,
          });
          resolvedCategoryIds.set(category.id, category.id);
          desiredPersistedCategoryIds.add(category.id);
        }
      }

      const subcategoriesById = new Map(existingSubcategories.map((row) => [row.id, row]));
      const subcategoriesByParentAndName = new Map(
        existingSubcategories.map((row) => [
          this.subcategoryKey(row.categoryId, row.normalizedValue),
          row,
        ]),
      );
      const desiredPersistedSubcategoryIds = new Set<string>();

      for (const subcategory of subcategories) {
        const resolvedParentId = resolvedCategoryIds.get(subcategory.categoryId);
        if (!resolvedParentId) {
          throw new Error(`Cannot persist subcategory without parent "${subcategory.categoryId}"`);
        }

        const naturalKeyMatch = subcategoriesByParentAndName.get(
          this.subcategoryKey(resolvedParentId, subcategory.normalizedName),
        );
        const idMatch = subcategoriesById.get(subcategory.id);

        if (naturalKeyMatch) {
          await tx
            .update(userSubcategories)
            .set({ rawValue: subcategory.name, isActive: true })
            .where(eq(userSubcategories.id, naturalKeyMatch.id));
          desiredPersistedSubcategoryIds.add(naturalKeyMatch.id);
        } else if (idMatch) {
          await tx
            .update(userSubcategories)
            .set({
              categoryId: resolvedParentId,
              rawValue: subcategory.name,
              normalizedValue: subcategory.normalizedName,
              isActive: true,
            })
            .where(eq(userSubcategories.id, idMatch.id));
          desiredPersistedSubcategoryIds.add(idMatch.id);
        } else {
          await tx.insert(userSubcategories).values({
            id: subcategory.id,
            categoryId: resolvedParentId,
            rawValue: subcategory.name,
            normalizedValue: subcategory.normalizedName,
            usageCount: 0,
            isActive: true,
          });
          desiredPersistedSubcategoryIds.add(subcategory.id);
        }
      }

      for (const row of existingSubcategories) {
        if (!desiredPersistedSubcategoryIds.has(row.id) && row.isActive) {
          await tx
            .update(userSubcategories)
            .set({ isActive: false })
            .where(eq(userSubcategories.id, row.id));
        }
      }

      for (const row of existingCategories) {
        if (!desiredPersistedCategoryIds.has(row.id) && row.isActive) {
          await tx
            .update(userCategories)
            .set({ isActive: false })
            .where(eq(userCategories.id, row.id));
        }
      }
    });
  }

  private subcategoryKey(categoryId: string, normalizedName: string): string {
    return `${categoryId}\u0000${normalizedName}`;
  }
}

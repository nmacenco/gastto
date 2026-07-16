// LAYER: Infrastructure
// Concrete ICategoryVocabularyRepository implementation using Drizzle ORM.
// Maps between the CategoryVocabulary aggregate and user_categories rows.

import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { userCategories } from '../schema';
import type * as schema from '../schema';
import type { ICategoryVocabularyRepository } from '../../../domain/ports/repositories';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';

export class DrizzleCategoryVocabularyRepository implements ICategoryVocabularyRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findBySpreadsheetId(spreadsheetId: string): Promise<CategoryVocabulary | null> {
    const rows = await this.db
      .select()
      .from(userCategories)
      .where(
        and(eq(userCategories.spreadsheetId, spreadsheetId), eq(userCategories.isActive, true)),
      );

    if (rows.length === 0) {
      return null;
    }

    const categories = rows.map((row) => ({
      id: row.id,
      name: row.rawValue,
      normalizedName: row.normalizedValue,
    }));

    return new CategoryVocabulary(spreadsheetId, categories);
  }

  async save(vocabulary: CategoryVocabulary): Promise<void> {
    const spreadsheetId = vocabulary.spreadsheetId;
    const categories = vocabulary.getCategories();
    const vocabularyNormalized = new Set(categories.map((c) => c.normalizedName));

    const existingRows = await this.db
      .select()
      .from(userCategories)
      .where(eq(userCategories.spreadsheetId, spreadsheetId));

    await this.db.transaction(async (tx) => {
      // Soft-delete categories not present in the vocabulary
      for (const row of existingRows) {
        if (!vocabularyNormalized.has(row.normalizedValue)) {
          await tx
            .update(userCategories)
            .set({ isActive: false })
            .where(eq(userCategories.id, row.id));
        }
      }

      // Upsert all categories in the vocabulary
      for (const category of categories) {
        await tx
          .insert(userCategories)
          .values({
            spreadsheetId,
            rawValue: category.name,
            normalizedValue: category.normalizedName,
            usageCount: 0,
            isActive: true,
          })
          .onConflictDoUpdate({
            target: [userCategories.spreadsheetId, userCategories.normalizedValue],
            set: {
              rawValue: category.name,
              isActive: true,
            },
          });
      }
    });
  }
}

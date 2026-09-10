// LAYER: Infrastructure
// Concrete IUserSubcategoryRepository implementation using Drizzle ORM.

import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { UserSubcategory } from '../../../domain/entities/SpreadsheetConfig';
import type { IUserSubcategoryRepository } from '../../../domain/ports/repositories';
import type * as schema from '../schema';
import { userSubcategories } from '../schema';

export class DrizzleUserSubcategoryRepository implements IUserSubcategoryRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findActiveByCategoryId(categoryId: string): Promise<UserSubcategory[]> {
    const rows = await this.db
      .select()
      .from(userSubcategories)
      .where(
        and(eq(userSubcategories.categoryId, categoryId), eq(userSubcategories.isActive, true)),
      );

    return rows.map((row) => this.mapUserSubcategory(row));
  }

  async upsertMany(subcategories: Omit<UserSubcategory, 'createdAt'>[]): Promise<void> {
    if (subcategories.length === 0) return;

    await this.db.transaction(async (tx) => {
      for (const subcategory of subcategories) {
        await tx
          .insert(userSubcategories)
          .values({
            id: subcategory.id,
            categoryId: subcategory.categoryId,
            rawValue: subcategory.rawValue,
            normalizedValue: subcategory.normalizedValue,
            usageCount: subcategory.usageCount,
            isActive: subcategory.isActive,
          })
          .onConflictDoUpdate({
            target: [userSubcategories.categoryId, userSubcategories.normalizedValue],
            set: {
              rawValue: subcategory.rawValue,
              isActive: subcategory.isActive,
            },
          });
      }
    });
  }

  async incrementUsage(id: string): Promise<void> {
    const [row] = await this.db
      .update(userSubcategories)
      .set({ usageCount: sql`${userSubcategories.usageCount} + 1` })
      .where(eq(userSubcategories.id, id))
      .returning();

    if (!row) throw new Error('Failed to increment subcategory usage');
  }

  private mapUserSubcategory(row: typeof userSubcategories.$inferSelect): UserSubcategory {
    return {
      id: row.id,
      categoryId: row.categoryId,
      rawValue: row.rawValue,
      normalizedValue: row.normalizedValue,
      usageCount: row.usageCount,
      isActive: row.isActive,
      createdAt: row.createdAt,
    };
  }
}

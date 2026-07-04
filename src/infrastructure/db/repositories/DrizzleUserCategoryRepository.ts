// LAYER: Infrastructure
// Concrete IUserCategoryRepository implementation using Drizzle ORM.
// Maps between schema row shape and domain UserCategory entity.

import { eq, and, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { userCategories } from '../schema';
import type * as schema from '../schema';
import type { IUserCategoryRepository } from '../../../domain/ports/repositories';
import type { UserCategory } from '../../../domain/entities/SpreadsheetConfig';

export class DrizzleUserCategoryRepository implements IUserCategoryRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findActiveBySpreadsheetId(spreadsheetId: string): Promise<UserCategory[]> {
    const rows = await this.db
      .select()
      .from(userCategories)
      .where(
        and(eq(userCategories.spreadsheetId, spreadsheetId), eq(userCategories.isActive, true)),
      );

    return rows.map((row) => this.mapUserCategory(row));
  }

  async upsertMany(categories: Omit<UserCategory, 'id' | 'createdAt'>[]): Promise<void> {
    if (categories.length === 0) return;

    await this.db.transaction(async (tx) => {
      for (const category of categories) {
        await tx
          .insert(userCategories)
          .values({
            spreadsheetId: category.spreadsheetId,
            rawValue: category.rawValue,
            normalizedValue: category.normalizedValue,
            usageCount: category.usageCount,
            isActive: category.isActive,
          })
          .onConflictDoUpdate({
            target: [userCategories.spreadsheetId, userCategories.normalizedValue],
            set: {
              rawValue: category.rawValue,
              isActive: category.isActive,
            },
          });
      }
    });
  }

  async incrementUsage(id: string): Promise<void> {
    const [row] = await this.db
      .update(userCategories)
      .set({
        usageCount: sql`${userCategories.usageCount} + 1`,
      })
      .where(eq(userCategories.id, id))
      .returning();

    if (!row) throw new Error('Failed to increment category usage');
  }

  // ── Mappers ────────────────────────────────────────────────────────────────

  private mapUserCategory(row: typeof userCategories.$inferSelect): UserCategory {
    return {
      id: row.id,
      spreadsheetId: row.spreadsheetId,
      rawValue: row.rawValue,
      normalizedValue: row.normalizedValue,
      usageCount: row.usageCount,
      isActive: row.isActive,
      createdAt: row.createdAt,
    };
  }
}

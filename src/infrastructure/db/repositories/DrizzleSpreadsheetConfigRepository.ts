// LAYER: Infrastructure
// Drizzle implementation of ISpreadsheetConfigRepository.
// Stores and retrieves spreadsheet configuration records per user.

import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ISpreadsheetConfigRepository } from '../../../domain/ports/repositories';
import type {
  SpreadsheetConfig,
  SpreadsheetProvider,
} from '../../../domain/entities/SpreadsheetConfig';
import * as schema from '../schema';

export class DrizzleSpreadsheetConfigRepository implements ISpreadsheetConfigRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findByUserId(userId: string): Promise<SpreadsheetConfig | null> {
    const [row] = await this.db
      .select()
      .from(schema.spreadsheetConfigs)
      .where(
        and(
          eq(schema.spreadsheetConfigs.userId, userId),
          eq(schema.spreadsheetConfigs.isActive, true),
        ),
      )
      .limit(1);

    return row ? this.mapSpreadsheetConfig(row) : null;
  }

  async findById(id: string): Promise<SpreadsheetConfig | null> {
    const [row] = await this.db
      .select()
      .from(schema.spreadsheetConfigs)
      .where(eq(schema.spreadsheetConfigs.id, id))
      .limit(1);
    return row ? this.mapSpreadsheetConfig(row) : null;
  }

  async create(
    config: Omit<
      SpreadsheetConfig,
      'id' | 'createdAt' | 'updatedAt' | 'isActive' | 'headerRowIndex'
    >,
  ): Promise<SpreadsheetConfig> {
    const [row] = await this.db
      .insert(schema.spreadsheetConfigs)
      .values({
        userId: config.userId,
        provider: config.provider,
        fileId: config.fileId,
        fileName: config.fileName,
        sheetName: config.sheetName,
        accessVerifiedAt: config.accessVerifiedAt,
      })
      .returning();

    if (!row) throw new Error('Failed to create spreadsheet config');

    return this.mapSpreadsheetConfig(row);
  }

  async createOrResumeInitial(
    config: Omit<
      SpreadsheetConfig,
      'id' | 'createdAt' | 'updatedAt' | 'isActive' | 'headerRowIndex'
    >,
  ): Promise<SpreadsheetConfig> {
    const [row] = await this.db
      .insert(schema.spreadsheetConfigs)
      .values({
        userId: config.userId,
        provider: config.provider,
        fileId: config.fileId,
        fileName: config.fileName,
        sheetName: config.sheetName,
        accessVerifiedAt: config.accessVerifiedAt,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return this.mapSpreadsheetConfig(row);

    const current = await this.findByUserId(config.userId);
    if (!current) throw new Error('Failed to resume spreadsheet config');
    if (
      current.provider === config.provider &&
      current.fileId === config.fileId &&
      current.sheetName === config.sheetName
    ) {
      return current;
    }
    if (current.categoriesConfirmedAt) {
      throw new Error('Configured destination changes require settings activation');
    }
    const [expense] = await this.db
      .select({ id: schema.expenseRecords.id })
      .from(schema.expenseRecords)
      .where(eq(schema.expenseRecords.spreadsheetId, current.id))
      .limit(1);
    if (expense)
      throw new Error('Destination referenced by an expense requires settings activation');
    const [updated] = await this.db
      .update(schema.spreadsheetConfigs)
      .set({
        provider: config.provider,
        fileId: config.fileId,
        fileName: config.fileName,
        sheetName: config.sheetName,
        accessVerifiedAt: config.accessVerifiedAt,
        headerRowIndex: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.spreadsheetConfigs.id, current.id),
          eq(schema.spreadsheetConfigs.isActive, true),
        ),
      )
      .returning();
    if (!updated) throw new Error('Failed to resume spreadsheet config');
    return this.mapSpreadsheetConfig(updated);
  }

  async updateAccessVerified(id: string): Promise<void> {
    const [row] = await this.db
      .update(schema.spreadsheetConfigs)
      .set({
        accessVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.spreadsheetConfigs.id, id))
      .returning();

    if (!row) throw new Error('Failed to update access verified timestamp');
  }

  async updateHeaderRowIndex(id: string, headerRowIndex: number): Promise<void> {
    if (!Number.isInteger(headerRowIndex) || headerRowIndex < 1)
      throw new Error('Invalid header row');
    await this.db
      .update(schema.spreadsheetConfigs)
      .set({ headerRowIndex, updatedAt: new Date() })
      .where(eq(schema.spreadsheetConfigs.id, id));
  }

  async updateCategoriesConfirmed(id: string): Promise<void> {
    const [row] = await this.db
      .update(schema.spreadsheetConfigs)
      .set({
        categoriesConfirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.spreadsheetConfigs.id, id))
      .returning();

    if (!row) throw new Error('Failed to update categories confirmed timestamp');
  }

  // ── Mappers ────────────────────────────────────────────────────────────────

  private mapSpreadsheetConfig(
    row: typeof schema.spreadsheetConfigs.$inferSelect,
  ): SpreadsheetConfig {
    return {
      id: row.id,
      userId: row.userId,
      provider: row.provider as SpreadsheetProvider,
      fileId: row.fileId,
      fileName: row.fileName,
      sheetName: row.sheetName,
      isActive: row.isActive,
      headerRowIndex: row.headerRowIndex,
      accessVerifiedAt: row.accessVerifiedAt,
      categoriesConfirmedAt: row.categoriesConfirmedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

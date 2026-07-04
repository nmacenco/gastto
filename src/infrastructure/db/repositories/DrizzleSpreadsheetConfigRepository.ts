// LAYER: Infrastructure
// Drizzle implementation of ISpreadsheetConfigRepository.
// Stores and retrieves spreadsheet configuration records per user.

import { eq } from 'drizzle-orm';
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
      .where(eq(schema.spreadsheetConfigs.userId, userId))
      .limit(1);

    return row ? this.mapSpreadsheetConfig(row) : null;
  }

  async create(
    config: Omit<SpreadsheetConfig, 'id' | 'createdAt' | 'updatedAt'>,
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
      accessVerifiedAt: row.accessVerifiedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

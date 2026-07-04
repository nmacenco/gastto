// LAYER: Infrastructure
// Drizzle implementation of IColumnMappingRepository.
// Stores and retrieves column mapping records per spreadsheet.

import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { IColumnMappingRepository } from '../../../domain/ports/repositories';
import type { ColumnMapping, GasttoField } from '../../../domain/entities/SpreadsheetConfig';
import * as schema from '../schema';

export class DrizzleColumnMappingRepository implements IColumnMappingRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findBySpreadsheetId(spreadsheetId: string): Promise<ColumnMapping[]> {
    const rows = await this.db
      .select()
      .from(schema.columnMappings)
      .where(eq(schema.columnMappings.spreadsheetId, spreadsheetId));

    return rows.map((row) => this.mapColumnMapping(row));
  }

  async upsertMany(mappings: Omit<ColumnMapping, 'id'>[]): Promise<void> {
    if (mappings.length === 0) return;

    await this.db
      .insert(schema.columnMappings)
      .values(
        mappings.map((m) => ({
          spreadsheetId: m.spreadsheetId,
          gasttoField: m.GasttoField,
          columnIndex: m.columnIndex,
          columnHeader: m.columnHeader,
          inferred: m.inferred,
          confirmedAt: m.confirmedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.columnMappings.spreadsheetId, schema.columnMappings.gasttoField],
        set: {
          columnIndex: sql`excluded.column_index`,
          columnHeader: sql`excluded.column_header`,
          inferred: sql`excluded.inferred`,
          confirmedAt: sql`excluded.confirmed_at`,
        },
      });
  }

  async confirm(id: string): Promise<void> {
    const [row] = await this.db
      .update(schema.columnMappings)
      .set({ confirmedAt: new Date() })
      .where(eq(schema.columnMappings.id, id))
      .returning();

    if (!row) throw new Error('Column mapping not found');
  }

  async confirmBySpreadsheetId(spreadsheetId: string): Promise<void> {
    await this.db
      .update(schema.columnMappings)
      .set({ confirmedAt: new Date() })
      .where(eq(schema.columnMappings.spreadsheetId, spreadsheetId));
  }

  async updateCorrected(mapping: Partial<ColumnMapping> & { id: string }): Promise<void> {
    const set: Partial<typeof schema.columnMappings.$inferInsert> = {};

    if (mapping.columnIndex !== undefined) set.columnIndex = mapping.columnIndex;
    if (mapping.columnHeader !== undefined) set.columnHeader = mapping.columnHeader;
    if (mapping.inferred !== undefined) set.inferred = mapping.inferred;

    const [row] = await this.db
      .update(schema.columnMappings)
      .set(set)
      .where(eq(schema.columnMappings.id, mapping.id))
      .returning();

    if (!row) throw new Error('Column mapping not found');
  }

  private mapColumnMapping(row: typeof schema.columnMappings.$inferSelect): ColumnMapping {
    return {
      id: row.id,
      spreadsheetId: row.spreadsheetId,
      GasttoField: row.gasttoField as GasttoField,
      columnIndex: row.columnIndex,
      columnHeader: row.columnHeader,
      inferred: row.inferred,
      confirmedAt: row.confirmedAt,
    };
  }
}

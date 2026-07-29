// LAYER: Infrastructure
// Concrete IExpenseRecordRepository implementation using Drizzle ORM.
// Maps between schema row shape and domain ExpenseRecord entity.

import { eq, and, desc, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { expenseRecords } from '../schema';
import type * as schema from '../schema';
import type { IExpenseRecordRepository } from '../../../domain/ports/repositories';
import type { ExpenseRecord } from '../../../domain/entities/ExpenseRecord';
import type { Currency } from '../../../domain/entities/User';

export class DrizzleExpenseRecordRepository implements IExpenseRecordRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async create(
    record: Omit<ExpenseRecord, 'id' | 'createdAt' | 'savedAt'>,
  ): Promise<ExpenseRecord> {
    const [row] = await this.db
      .insert(expenseRecords)
      .values({
        userId: record.userId,
        spreadsheetId: record.spreadsheetId,
        concepto: record.concepto,
        monto: String(record.monto),
        moneda: record.moneda,
        categoria: record.categoria,
        fechaGasto: record.fechaGasto.toISOString().slice(0, 10),
        medioPago: record.medioPago,
        sheetName: record.sheetName,
        rowIndex: record.rowIndex,
        categoriaConfidence: record.categoriaConfidence,
        rawMessage: record.rawMessage,
        isDeleted: record.isDeleted,
        deletedAt: record.deletedAt,
      })
      .returning();

    if (!row) throw new Error('Failed to create expense record');

    return this.mapExpenseRecord(row);
  }

  async findLatestByUserId(userId: string): Promise<ExpenseRecord | null> {
    const rows = await this.db
      .select()
      .from(expenseRecords)
      .where(and(eq(expenseRecords.userId, userId), eq(expenseRecords.isDeleted, false)))
      .orderBy(desc(expenseRecords.savedAt))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return this.mapExpenseRecord(row);
  }

  async findRecentCurrenciesByUserId(
    userId: string,
    limit: number,
  ): Promise<ExpenseRecord['moneda'][]> {
    const rows = await this.db
      .selectDistinct({ moneda: expenseRecords.moneda })
      .from(expenseRecords)
      .where(and(eq(expenseRecords.userId, userId), eq(expenseRecords.isDeleted, false)))
      .orderBy(desc(expenseRecords.savedAt))
      .limit(limit);

    return rows.map((row) => row.moneda).filter((moneda): moneda is Currency => moneda !== null);
  }

  async softDelete(id: string): Promise<void> {
    const [row] = await this.db
      .update(expenseRecords)
      .set({
        isDeleted: true,
        deletedAt: sql`now()`,
      })
      .where(eq(expenseRecords.id, id))
      .returning();

    if (!row) throw new Error('Failed to soft-delete expense record');
  }

  // ── Mappers ────────────────────────────────────────────────────────────────

  private mapExpenseRecord(row: typeof expenseRecords.$inferSelect): ExpenseRecord {
    return {
      id: row.id,
      userId: row.userId,
      spreadsheetId: row.spreadsheetId,
      concepto: row.concepto,
      monto: Number(row.monto),
      moneda: row.moneda as ExpenseRecord['moneda'],
      categoria: row.categoria,
      fechaGasto: new Date(row.fechaGasto),
      medioPago: row.medioPago,
      sheetName: row.sheetName,
      rowIndex: row.rowIndex,
      categoriaConfidence: row.categoriaConfidence as ExpenseRecord['categoriaConfidence'],
      rawMessage: row.rawMessage,
      isDeleted: row.isDeleted,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
      savedAt: row.savedAt,
    };
  }
}

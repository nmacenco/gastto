// LAYER: Infrastructure / Tests
// Unit tests for DrizzleExpenseRecordRepository.
// Mocks Drizzle ORM database interface to avoid external DB dependency.

import { describe, it, expect, vi } from 'vitest';
import { DrizzleExpenseRecordRepository } from './DrizzleExpenseRecordRepository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';

function buildExpenseRecordRow(overrides: Partial<typeof schema.expenseRecords.$inferSelect> = {}) {
  return {
    id: 'expense-123',
    userId: 'user-123',
    spreadsheetId: 'sheet-123',
    concepto: 'Cafe',
    monto: '850.00',
    moneda: 'ARS',
    categoria: 'Comida',
    fechaGasto: new Date('2026-01-15'),
    medioPago: 'Efectivo',
    sheetName: 'Gastos',
    rowIndex: 42,
    categoriaConfidence: 'alta',
    rawMessage: 'Cafe 850',
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-15T10:00:00Z'),
    savedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('DrizzleExpenseRecordRepository', () => {
  describe('create', () => {
    it('inserts a record and returns mapped entity', async () => {
      const row = buildExpenseRecordRow();
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([row]),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleExpenseRecordRepository(db);
      const result = await repo.create({
        userId: 'user-123',
        spreadsheetId: 'sheet-123',
        concepto: 'Cafe',
        monto: 850,
        moneda: 'ARS',
        categoria: 'Comida',
        fechaGasto: new Date('2026-01-15'),
        medioPago: 'Efectivo',
        sheetName: 'Gastos',
        rowIndex: 42,
        categoriaConfidence: 'alta',
        rawMessage: 'Cafe 850',
        isDeleted: false,
        deletedAt: null,
      });

      expect(result.id).toBe('expense-123');
      expect(result.monto).toBe(850);
      expect(result.moneda).toBe('ARS');
    });

    it('throws when insert returns no row', async () => {
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleExpenseRecordRepository(db);
      await expect(
        repo.create({
          userId: 'user-123',
          spreadsheetId: 'sheet-123',
          concepto: 'Cafe',
          monto: 850,
          moneda: 'ARS',
          categoria: 'Comida',
          fechaGasto: new Date('2026-01-15'),
          medioPago: null,
          sheetName: 'Gastos',
          rowIndex: 42,
          categoriaConfidence: null,
          rawMessage: 'Cafe 850',
          isDeleted: false,
          deletedAt: null,
        }),
      ).rejects.toThrow('Failed to create expense record');
    });
  });

  describe('findLatestByUserId', () => {
    it('returns the latest non-deleted record', async () => {
      const row = buildExpenseRecordRow();
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([row]),
              }),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleExpenseRecordRepository(db);
      const result = await repo.findLatestByUserId('user-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('expense-123');
      expect(result?.monto).toBe(850);
    });

    it('returns null when no non-deleted records exist', async () => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleExpenseRecordRepository(db);
      const result = await repo.findLatestByUserId('user-999');

      expect(result).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('marks record as deleted', async () => {
      const row = buildExpenseRecordRow({ isDeleted: true, deletedAt: new Date() });
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([row]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleExpenseRecordRepository(db);
      await expect(repo.softDelete('expense-123')).resolves.toBeUndefined();
    });

    it('throws when update returns no row', async () => {
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleExpenseRecordRepository(db);
      await expect(repo.softDelete('expense-999')).rejects.toThrow(
        'Failed to soft-delete expense record',
      );
    });
  });
});

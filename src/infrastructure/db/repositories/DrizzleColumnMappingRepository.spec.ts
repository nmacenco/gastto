// LAYER: Infrastructure / Tests
// Unit tests for DrizzleColumnMappingRepository.
// Mocks Drizzle ORM database interface to avoid external DB dependency.

import { describe, it, expect, vi } from 'vitest';
import { DrizzleColumnMappingRepository } from './DrizzleColumnMappingRepository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../schema';

function buildColumnMappingRow(overrides: Partial<typeof schema.columnMappings.$inferSelect> = {}) {
  return {
    id: 'mapping-123',
    spreadsheetId: 'config-123',
    gasttoField: 'monto',
    columnIndex: 1,
    columnHeader: 'Amount',
    inferred: true,
    confirmedAt: null,
    ...overrides,
  };
}

describe('DrizzleColumnMappingRepository', () => {
  describe('findBySpreadsheetId', () => {
    it('returns mapped ColumnMapping[] when rows exist', async () => {
      const rows = [
        buildColumnMappingRow({ gasttoField: 'monto', columnIndex: 1, columnHeader: 'Amount' }),
        buildColumnMappingRow({
          id: 'mapping-456',
          gasttoField: 'fecha',
          columnIndex: 0,
          columnHeader: 'Date',
        }),
      ];
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleColumnMappingRepository(db);
      const result = await repo.findBySpreadsheetId('config-123');

      expect(result).toEqual([
        {
          id: 'mapping-123',
          spreadsheetId: 'config-123',
          GasttoField: 'monto',
          columnIndex: 1,
          columnHeader: 'Amount',
          inferred: true,
          confirmedAt: null,
        },
        {
          id: 'mapping-456',
          spreadsheetId: 'config-123',
          GasttoField: 'fecha',
          columnIndex: 0,
          columnHeader: 'Date',
          inferred: true,
          confirmedAt: null,
        },
      ]);
    });

    it('returns empty array when no mappings exist', async () => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleColumnMappingRepository(db);
      const result = await repo.findBySpreadsheetId('config-999');

      expect(result).toEqual([]);
    });
  });

  describe('upsertMany', () => {
    it('inserts new mappings in a single query', async () => {
      const insertMock = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      });
      const db = {
        insert: insertMock,
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleColumnMappingRepository(db);
      await repo.upsertMany([
        {
          spreadsheetId: 'config-123',
          GasttoField: 'monto',
          columnIndex: 1,
          columnHeader: 'Amount',
          inferred: true,
          confirmedAt: null,
        },
        {
          spreadsheetId: 'config-123',
          GasttoField: 'fecha',
          columnIndex: 0,
          columnHeader: 'Date',
          inferred: true,
          confirmedAt: null,
        },
      ]);

      expect(insertMock).toHaveBeenCalledTimes(1);
    });

    it('configures ON CONFLICT update for spreadsheet_id and gastto_field', async () => {
      const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
      const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
      const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
      const db = { insert: insertMock } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleColumnMappingRepository(db);
      await repo.upsertMany([
        {
          spreadsheetId: 'config-123',
          GasttoField: 'monto',
          columnIndex: 1,
          columnHeader: 'Amount',
          inferred: true,
          confirmedAt: null,
        },
      ]);

      expect(valuesMock).toHaveBeenCalledWith([
        {
          spreadsheetId: 'config-123',
          gasttoField: 'monto',
          columnIndex: 1,
          columnHeader: 'Amount',
          inferred: true,
          confirmedAt: null,
        },
      ]);
      expect(onConflictDoUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          target: [schema.columnMappings.spreadsheetId, schema.columnMappings.gasttoField],
        }),
      );
    });

    it('does nothing when mappings array is empty', async () => {
      const insertMock = vi.fn();
      const db = {
        insert: insertMock,
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleColumnMappingRepository(db);
      await repo.upsertMany([]);

      expect(insertMock).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('sets confirmedAt to current timestamp', async () => {
      const row = buildColumnMappingRow({ confirmedAt: new Date('2026-06-17T00:00:00Z') });
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([row]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleColumnMappingRepository(db);
      await expect(repo.confirm('mapping-123')).resolves.toBeUndefined();
    });

    it('throws when mapping does not exist', async () => {
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleColumnMappingRepository(db);
      await expect(repo.confirm('mapping-999')).rejects.toThrow('Column mapping not found');
    });
  });
});

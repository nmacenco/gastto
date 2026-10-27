// LAYER: Infrastructure / Tests
// Unit tests for DrizzleSpreadsheetConfigRepository.
// Mocks Drizzle ORM database interface to avoid external DB dependency.

import { describe, it, expect, vi } from 'vitest';
import { DrizzleSpreadsheetConfigRepository } from './DrizzleSpreadsheetConfigRepository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';

function buildSpreadsheetConfigRow(
  overrides: Partial<typeof schema.spreadsheetConfigs.$inferSelect> = {},
) {
  return {
    id: 'config-123',
    userId: 'user-123',
    provider: 'google' as const,
    fileId: 'file-abc',
    fileName: 'Budget 2026',
    sheetName: 'Gastos',
    isActive: true,
    headerRowIndex: null,
    accessVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    categoriesConfirmedAt: null as Date | null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('DrizzleSpreadsheetConfigRepository', () => {
  describe('findByUserId', () => {
    it('returns mapped SpreadsheetConfig when row exists', async () => {
      const row = buildSpreadsheetConfigRow({ provider: 'microsoft' as const });
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([row]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleSpreadsheetConfigRepository(db);
      const result = await repo.findByUserId('user-123');

      expect(result).toEqual({
        id: 'config-123',
        userId: 'user-123',
        provider: 'microsoft',
        fileId: 'file-abc',
        fileName: 'Budget 2026',
        sheetName: 'Gastos',
        isActive: true,
        headerRowIndex: null,
        accessVerifiedAt: row.accessVerifiedAt,
        categoriesConfirmedAt: null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    });

    it('returns null when row does not exist', async () => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleSpreadsheetConfigRepository(db);
      const result = await repo.findByUserId('user-999');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('inserts a new config and returns mapped entity', async () => {
      const row = buildSpreadsheetConfigRow();
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([row]),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleSpreadsheetConfigRepository(db);
      const result = await repo.create({
        userId: 'user-123',
        provider: 'google',
        fileId: 'file-abc',
        fileName: 'Budget 2026',
        sheetName: 'Gastos',
        accessVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        categoriesConfirmedAt: null,
      });

      expect(result.id).toBe('config-123');
      expect(result.userId).toBe('user-123');
      expect(result.provider).toBe('google');
      expect(result.fileId).toBe('file-abc');
      expect(result.fileName).toBe('Budget 2026');
      expect(result.sheetName).toBe('Gastos');
      expect(result.accessVerifiedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    });

    it('throws when insert returns no row', async () => {
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleSpreadsheetConfigRepository(db);
      await expect(
        repo.create({
          userId: 'user-123',
          provider: 'google',
          fileId: 'file-abc',
          fileName: 'Budget 2026',
          sheetName: 'Gastos',
          accessVerifiedAt: new Date(),
          categoriesConfirmedAt: null,
        }),
      ).rejects.toThrow('Failed to create spreadsheet config');
    });
  });

  describe('updateAccessVerified', () => {
    it('updates accessVerifiedAt and updatedAt', async () => {
      const row = buildSpreadsheetConfigRow();
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([row]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleSpreadsheetConfigRepository(db);
      await expect(repo.updateAccessVerified('config-123')).resolves.toBeUndefined();
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

      const repo = new DrizzleSpreadsheetConfigRepository(db);
      await expect(repo.updateAccessVerified('config-999')).rejects.toThrow(
        'Failed to update access verified timestamp',
      );
    });
  });

  describe('updateCategoriesConfirmed', () => {
    it('updates categoriesConfirmedAt and updatedAt', async () => {
      const row = buildSpreadsheetConfigRow();
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([row]),
            }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleSpreadsheetConfigRepository(db);
      await expect(repo.updateCategoriesConfirmed('config-123')).resolves.toBeUndefined();
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

      const repo = new DrizzleSpreadsheetConfigRepository(db);
      await expect(repo.updateCategoriesConfirmed('config-999')).rejects.toThrow(
        'Failed to update categories confirmed timestamp',
      );
    });
  });

  describe('createOrResumeInitial', () => {
    const selected = {
      userId: 'user-123',
      provider: 'google' as const,
      fileId: 'file-new',
      fileName: 'Budget 2027',
      sheetName: 'T 6',
      accessVerifiedAt: new Date('2026-07-05T00:00:00Z'),
      categoriesConfirmedAt: null,
    };

    it('creates a new active version when no configuration exists', async () => {
      const row = buildSpreadsheetConfigRow({
        fileId: selected.fileId,
        sheetName: selected.sheetName,
      });
      const onConflictDoNothing = vi
        .fn()
        .mockReturnValue({ returning: vi.fn().mockResolvedValue([row]) });
      const db = {
        insert: vi
          .fn()
          .mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing }) }),
      } as unknown as PostgresJsDatabase<typeof schema>;
      const result = await new DrizzleSpreadsheetConfigRepository(db).createOrResumeInitial(
        selected,
      );
      expect(onConflictDoNothing).toHaveBeenCalled();
      expect(result.id).toBe(row.id);
      expect(result.isActive).toBe(true);
    });

    it('retains the destination and ID of an already configured user', async () => {
      const existing = buildSpreadsheetConfigRow({ categoriesConfirmedAt: new Date() });
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi
              .fn()
              .mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([existing]) }),
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;
      await expect(
        new DrizzleSpreadsheetConfigRepository(db).createOrResumeInitial(selected),
      ).rejects.toThrow('Configured destination changes require settings activation');
      expect('update' in db).toBe(false);
    });
  });
});

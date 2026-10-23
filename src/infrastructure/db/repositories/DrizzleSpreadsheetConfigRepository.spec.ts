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

  describe('upsertByUserId', () => {
    const newConfig = {
      userId: 'user-123',
      provider: 'google' as const,
      fileId: 'file-new',
      fileName: 'Budget 2027',
      sheetName: 'T 6',
      accessVerifiedAt: new Date('2026-07-05T00:00:00Z'),
      categoriesConfirmedAt: null,
    };

    it('inserts a new config when none exists and returns the mapped entity', async () => {
      const insertedRow = buildSpreadsheetConfigRow({
        fileId: 'file-new',
        fileName: 'Budget 2027',
        sheetName: 'T 6',
        accessVerifiedAt: newConfig.accessVerifiedAt,
      });
      const onConflict = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([insertedRow]),
      });
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: onConflict,
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleSpreadsheetConfigRepository(db);
      const result = await repo.upsertByUserId(newConfig);

      expect(onConflict).toHaveBeenCalled();
      expect(result.id).toBe('config-123');
      expect(result.userId).toBe('user-123');
      expect(result.fileId).toBe('file-new');
      expect(result.fileName).toBe('Budget 2027');
      expect(result.sheetName).toBe('T 6');
      expect(result.accessVerifiedAt).toEqual(new Date('2026-07-05T00:00:00Z'));
    });

    it('updates provider, fileId, fileName, sheetName, accessVerifiedAt and updatedAt when a row already exists (re-onboarding)', async () => {
      const originalCreated = new Date('2026-01-01T00:00:00Z');
      const replacedRow = buildSpreadsheetConfigRow({
        id: 'config-keep-id',
        fileId: 'file-new',
        fileName: 'Budget 2027',
        sheetName: 'T 6',
        accessVerifiedAt: new Date('2026-07-05T00:00:00Z'),
        updatedAt: new Date('2026-07-05T00:00:00Z'),
        createdAt: originalCreated,
      });
      let capturedSet: Record<string, unknown> | undefined;
      const onConflict = vi.fn().mockImplementation((arg: { set: Record<string, unknown> }) => {
        capturedSet = arg.set;
        return { returning: vi.fn().mockResolvedValue([replacedRow]) };
      });
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: onConflict,
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleSpreadsheetConfigRepository(db);
      const result = await repo.upsertByUserId(newConfig);

      expect(capturedSet).toMatchObject({
        provider: 'google',
        fileId: 'file-new',
        fileName: 'Budget 2027',
        sheetName: 'T 6',
        accessVerifiedAt: newConfig.accessVerifiedAt,
      });
      expect((capturedSet as { updatedAt?: unknown }).updatedAt).toBeInstanceOf(Date);
      expect(result.id).toBe('config-keep-id');
      expect(result.createdAt).toEqual(originalCreated);
      expect(result.sheetName).toBe('T 6');
    });

    it('throws when upsert returns no row', async () => {
      const onConflict = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      });
      const db = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: onConflict,
          }),
        }),
      } as unknown as PostgresJsDatabase<typeof schema>;

      const repo = new DrizzleSpreadsheetConfigRepository(db);
      await expect(repo.upsertByUserId(newConfig)).rejects.toThrow(
        'Failed to upsert spreadsheet config',
      );
    });
  });
});

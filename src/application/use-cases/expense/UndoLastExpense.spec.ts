import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UndoLastExpenseUseCase } from './UndoLastExpense';
import type {
  IExpenseRecordRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';

const findLatest = vi.fn();
const softDeleteWithAudit = vi.fn();
const findConfig = vi.fn();
const logCreate = vi.fn();
const getValidAccessToken = vi.fn();
const forceRefreshAccessToken = vi.fn();
const deleteRow = vi.fn();
const createPort = vi.fn();
const transition = vi.fn();
const finalizeClaim = vi.fn();

function buildUseCase() {
  return new UndoLastExpenseUseCase(
    { create: createPort },
    { findLatestByUserId: findLatest, softDeleteWithAudit } as unknown as IExpenseRecordRepository,
    { findByUserId: findConfig } as unknown as ISpreadsheetConfigRepository,
    { create: logCreate },
    { getValidAccessToken, forceRefreshAccessToken },
    {
      execute: transition,
      assertCanStartFinancialEffect: vi.fn(),
      finalizeClaim,
    } as unknown as TransitionConversationState,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getValidAccessToken.mockResolvedValue({
    accessToken: 'access-token',
    expiresAt: new Date(Date.now() + 60_000),
    refreshed: false,
  });
  forceRefreshAccessToken.mockResolvedValue({
    accessToken: 'refreshed-access-token',
    expiresAt: new Date(Date.now() + 60_000),
    refreshed: true,
  });
  findLatest.mockResolvedValue({
    id: 'expense-1',
    concepto: 'Café',
    monto: 4.5,
    moneda: 'EUR',
    categoria: 'Comida original',
    categoryId: 'category-food',
    subcategoryId: 'subcategory-cafe',
    subcategoria: 'Cafetería original',
    sheetName: 'Gastos',
    rowIndex: 8,
    savedAt: new Date('2026-08-02T10:00:00Z'),
  });
  findConfig.mockResolvedValue({ provider: 'google', fileId: 'file-1' });
  createPort.mockReturnValue({ deleteRow });
  deleteRow.mockResolvedValue(undefined);
  softDeleteWithAudit.mockResolvedValue(undefined);
  transition.mockResolvedValue({ status: 'updated' });
  finalizeClaim.mockResolvedValue({ status: 'updated' });
});

describe('UndoLastExpenseUseCase', () => {
  it.each([
    ['renamed vocabulary', 'category-food', 'subcategory-cafe'],
    ['moved subcategory', 'category-food', 'subcategory-cafe'],
    ['soft-disabled vocabulary', 'category-food', 'subcategory-cafe'],
    ['hard-deleted vocabulary', null, null],
  ])(
    'targets the saved sheet row after %s regardless of nullable hierarchy references',
    async (_scenario, categoryId, subcategoryId) => {
      findLatest.mockResolvedValue({
        id: 'expense-1',
        concepto: 'Café',
        monto: 4.5,
        moneda: 'EUR',
        categoria: 'Comida original',
        categoryId,
        subcategoryId,
        subcategoria: 'Cafetería original',
        sheetName: 'Gastos históricos',
        rowIndex: 27,
        savedAt: new Date('2026-08-02T10:00:00Z'),
      });

      await expect(
        buildUseCase().execute({
          userId: 'user-1',
          action: 'request',
          immediateExpenseId: 'expense-1',
        }),
      ).resolves.toMatchObject({ status: 'deleted' });

      expect(findLatest).toHaveBeenCalledWith('user-1');
      expect(deleteRow).toHaveBeenCalledWith('file-1', 'Gastos históricos', 27);
      expect(softDeleteWithAudit).toHaveBeenCalledWith(
        'expense-1',
        'user-1',
        expect.objectContaining({ sheet: 'Gastos históricos', row: 27 }),
      );
    },
  );

  it('deletes externally before atomically soft-deleting and auditing locally', async () => {
    const result = await buildUseCase().execute({
      userId: 'user-1',
      action: 'request',
      immediateExpenseId: 'expense-1',
    });

    expect(result).toMatchObject({
      status: 'deleted',
      expense: { id: 'expense-1', concepto: 'Café' },
    });
    expect(deleteRow).toHaveBeenCalledWith('file-1', 'Gastos', 8);
    expect(softDeleteWithAudit).toHaveBeenCalledWith(
      'expense-1',
      'user-1',
      expect.objectContaining({ row: 8 }),
    );
    expect(deleteRow.mock.invocationCallOrder[0]!).toBeLessThan(
      softDeleteWithAudit.mock.invocationCallOrder[0]!,
    );
  });

  it('does not mutate local state or emit a deletion audit when Sheets rejects the deletion', async () => {
    deleteRow.mockRejectedValue(
      new SpreadsheetError('Google Sheets API error during row deletion: HTTP 403', {
        code: 'AUTH_ERROR',
      }),
    );

    await expect(
      buildUseCase().execute({
        userId: 'user-1',
        action: 'request',
        immediateExpenseId: 'expense-1',
      }),
    ).resolves.toEqual({ status: 'deletion_failed', errorType: 'AUTH_ERROR' });

    expect(softDeleteWithAudit).not.toHaveBeenCalled();
    expect(logCreate).toHaveBeenCalledWith(
      'user-1',
      'EXPENSE_SAVE_FAILED',
      { phase: 'undo' },
      'AUTH_ERROR',
    );
    expect(finalizeClaim).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: null }),
    );
  });

  it('retains an unresolved claim when row deletion may have reached Sheets', async () => {
    deleteRow.mockRejectedValue(
      new SpreadsheetError('Connection closed after deletion request', {
        code: 'NETWORK_ERROR',
        retryable: true,
        outcomeUnknown: true,
      }),
    );

    await buildUseCase().execute({
      userId: 'user-1',
      action: 'request',
      immediateExpenseId: 'expense-1',
    });

    expect(softDeleteWithAudit).not.toHaveBeenCalled();
    expect(JSON.stringify(finalizeClaim.mock.lastCall?.[0])).toContain(
      '"status":"outcome_unknown"',
    );
  });

  it('retains an unresolved claim when local finalization fails after remote deletion', async () => {
    softDeleteWithAudit.mockRejectedValue(new Error('database unavailable'));

    await buildUseCase().execute({
      userId: 'user-1',
      action: 'request',
      immediateExpenseId: 'expense-1',
    });

    expect(deleteRow).toHaveBeenCalledOnce();
    expect(JSON.stringify(finalizeClaim.mock.lastCall?.[0])).toContain(
      '"status":"outcome_unknown"',
    );
  });

  it('classifies an unexpected spreadsheet failure as a network error without local deletion', async () => {
    deleteRow.mockRejectedValue(new Error('socket closed'));

    await expect(
      buildUseCase().execute({
        userId: 'user-1',
        action: 'request',
        immediateExpenseId: 'expense-1',
      }),
    ).resolves.toEqual({ status: 'deletion_failed', errorType: 'NETWORK_ERROR' });

    expect(softDeleteWithAudit).not.toHaveBeenCalled();
    expect(logCreate).toHaveBeenCalledWith(
      'user-1',
      'EXPENSE_SAVE_FAILED',
      { phase: 'undo' },
      'NETWORK_ERROR',
    );
  });

  it('returns a structure error without external or local deletion when configuration is missing', async () => {
    findConfig.mockResolvedValue(null);

    await expect(
      buildUseCase().execute({
        userId: 'user-1',
        action: 'request',
        immediateExpenseId: 'expense-1',
      }),
    ).resolves.toEqual({ status: 'deletion_failed', errorType: 'STRUCTURE_ERROR' });

    expect(createPort).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
    expect(softDeleteWithAudit).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it('returns confirmation_required without creating a spreadsheet port when immediate undo is unavailable', async () => {
    await expect(
      buildUseCase().execute({ userId: 'user-1', action: 'request' }),
    ).resolves.toMatchObject({ status: 'confirmation_required', expense: { id: 'expense-1' } });
    expect(createPort).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
    expect(softDeleteWithAudit).not.toHaveBeenCalled();
  });

  it('requires confirmation without side effects when the immediate expense ID is stale', async () => {
    await expect(
      buildUseCase().execute({
        userId: 'user-1',
        action: 'request',
        immediateExpenseId: 'already-deleted-expense',
      }),
    ).resolves.toMatchObject({ status: 'confirmation_required', expense: { id: 'expense-1' } });

    expect(createPort).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
    expect(softDeleteWithAudit).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it('deletes once with a proactively refreshed expired token', async () => {
    getValidAccessToken.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      expiresAt: new Date(Date.now() + 60_000),
      refreshed: true,
    });

    await expect(
      buildUseCase().execute({
        userId: 'user-1',
        action: 'request',
        immediateExpenseId: 'expense-1',
      }),
    ).resolves.toMatchObject({ status: 'deleted' });

    expect(createPort).toHaveBeenCalledWith('refreshed-access-token');
    expect(deleteRow).toHaveBeenCalledTimes(1);
    expect(forceRefreshAccessToken).not.toHaveBeenCalled();
  });

  it('forces one refresh and retries deletion at most once after AUTH_ERROR', async () => {
    deleteRow
      .mockRejectedValueOnce(new SpreadsheetError('expired', { code: 'AUTH_ERROR' }))
      .mockResolvedValueOnce(undefined);

    await expect(
      buildUseCase().execute({
        userId: 'user-1',
        action: 'request',
        immediateExpenseId: 'expense-1',
      }),
    ).resolves.toMatchObject({ status: 'deleted' });

    expect(forceRefreshAccessToken).toHaveBeenCalledTimes(1);
    expect(createPort).toHaveBeenNthCalledWith(1, 'access-token');
    expect(createPort).toHaveBeenNthCalledWith(2, 'refreshed-access-token');
    expect(deleteRow).toHaveBeenCalledTimes(2);
    expect(softDeleteWithAudit).toHaveBeenCalledTimes(1);
  });
});

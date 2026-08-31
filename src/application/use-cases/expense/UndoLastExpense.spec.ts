import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UndoLastExpenseUseCase } from './UndoLastExpense';
import type {
  IExpenseRecordRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';

const findLatest = vi.fn();
const softDeleteWithAudit = vi.fn();
const findConfig = vi.fn();
const logCreate = vi.fn();
const getValidAccessToken = vi.fn();
const forceRefreshAccessToken = vi.fn();
const deleteRow = vi.fn();
const createPort = vi.fn();

function buildUseCase() {
  return new UndoLastExpenseUseCase(
    { create: createPort },
    { findLatestByUserId: findLatest, softDeleteWithAudit } as unknown as IExpenseRecordRepository,
    { findByUserId: findConfig } as unknown as ISpreadsheetConfigRepository,
    { create: logCreate },
    { getValidAccessToken, forceRefreshAccessToken },
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
    sheetName: 'Gastos',
    rowIndex: 8,
    savedAt: new Date('2026-08-02T10:00:00Z'),
  });
  findConfig.mockResolvedValue({ provider: 'google', fileId: 'file-1' });
  createPort.mockReturnValue({ deleteRow });
  deleteRow.mockResolvedValue(undefined);
  softDeleteWithAudit.mockResolvedValue(undefined);
});

describe('UndoLastExpenseUseCase', () => {
  it('deletes externally before atomically soft-deleting and auditing locally', async () => {
    const result = await buildUseCase().execute({
      userId: 'user-1',
      action: 'request',
      immediateEligible: true,
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
      buildUseCase().execute({ userId: 'user-1', action: 'request', immediateEligible: true }),
    ).resolves.toEqual({ status: 'deletion_failed', errorType: 'AUTH_ERROR' });

    expect(softDeleteWithAudit).not.toHaveBeenCalled();
    expect(logCreate).toHaveBeenCalledWith(
      'user-1',
      'EXPENSE_SAVE_FAILED',
      { phase: 'undo' },
      'AUTH_ERROR',
    );
  });

  it('returns confirmation_required without creating a spreadsheet port when immediate undo is unavailable', async () => {
    await expect(
      buildUseCase().execute({ userId: 'user-1', action: 'request', immediateEligible: false }),
    ).resolves.toMatchObject({ status: 'confirmation_required', expense: { id: 'expense-1' } });
    expect(createPort).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it('deletes once with a proactively refreshed expired token', async () => {
    getValidAccessToken.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      expiresAt: new Date(Date.now() + 60_000),
      refreshed: true,
    });

    await expect(
      buildUseCase().execute({ userId: 'user-1', action: 'request', immediateEligible: true }),
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
      buildUseCase().execute({ userId: 'user-1', action: 'request', immediateEligible: true }),
    ).resolves.toMatchObject({ status: 'deleted' });

    expect(forceRefreshAccessToken).toHaveBeenCalledTimes(1);
    expect(createPort).toHaveBeenNthCalledWith(1, 'access-token');
    expect(createPort).toHaveBeenNthCalledWith(2, 'refreshed-access-token');
    expect(deleteRow).toHaveBeenCalledTimes(2);
    expect(softDeleteWithAudit).toHaveBeenCalledTimes(1);
  });
});

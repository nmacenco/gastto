import { describe, expect, it, vi } from 'vitest';
import { DetectPaymentMethods } from './DetectPaymentMethods';
import type { OAuthAccessTokenProvider } from '../../services/OAuthAccessTokenService';
import type { SpreadsheetPortFactory } from '../../../domain/ports/services';

const base = {
  userId: 'user-1',
  provider: 'google' as const,
  fileId: 'file-1',
  sheetName: 'Gastos',
  headerRowIndex: 3,
  mappings: [{ field: 'medio_pago' as const, columnIndex: 4 }],
};

function setup(values: string[] = []) {
  const getUniqueValues = vi.fn().mockResolvedValue(values);
  const getValidAccessToken = vi.fn().mockResolvedValue({ accessToken: 'token' });
  const detector = new DetectPaymentMethods({
    tokenService: { getValidAccessToken } as unknown as OAuthAccessTokenProvider,
    spreadsheetPortFactory: {
      create: () => ({ getUniqueValues }),
    } as unknown as SpreadsheetPortFactory,
  });
  return { detector, getUniqueValues, getValidAccessToken };
}

describe('DetectPaymentMethods', () => {
  it('starts after the header and retains first spelling in source order', async () => {
    const t = setup([' Visa ', '', 'visa', 'Débito', 'débito', '  ']);
    await expect(t.detector.execute(base)).resolves.toEqual({
      names: ['Visa', 'Débito'],
      columnMapped: true,
    });
    expect(t.getUniqueValues).toHaveBeenCalledWith('file-1', 4, 'Gastos', 4);
  });

  it('offers an empty local proposal without a mapped column', async () => {
    const t = setup(['Visa']);
    await expect(t.detector.execute({ ...base, mappings: [] })).resolves.toEqual({
      names: [],
      columnMapped: false,
    });
    expect(t.getValidAccessToken).not.toHaveBeenCalled();
  });

  it('keeps a mapped but empty payment column as an empty proposal', async () => {
    const t = setup(['', '  ']);
    await expect(t.detector.execute(base)).resolves.toEqual({
      names: [],
      columnMapped: true,
    });
    expect(t.getUniqueValues).toHaveBeenCalledOnce();
  });

  it('keeps provider failure distinct from an empty column', async () => {
    const t = setup();
    t.getUniqueValues.mockRejectedValue(new Error('provider unavailable'));
    await expect(t.detector.execute(base)).rejects.toThrow('provider unavailable');
  });
});

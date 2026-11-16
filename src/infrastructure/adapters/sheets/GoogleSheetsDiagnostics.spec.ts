import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleSheetsAdapter } from './GoogleSheetsAdapter';

describe('Google Sheets safe diagnostics', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([400, 404, 401, 403, 503, 418])(
    'preserves HTTP %s classification for malformed bodies',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status,
          json: () => Promise.reject(new Error('private provider body')),
        }),
      );
      const adapter = new GoogleSheetsAdapter('test');
      await expect(adapter.listSheets('file')).rejects.toMatchObject({
        code:
          status === 400 || status === 404
            ? 'STRUCTURE_ERROR'
            : status === 401 || status === 403
              ? 'AUTH_ERROR'
              : status >= 500
                ? 'NETWORK_ERROR'
                : 'UNKNOWN',
        retryable: status >= 500,
        providerDiagnostic: { httpStatus: status },
      });
    },
  );
  it('retains only allowlisted status/reason and preserves uncertain writes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () =>
          Promise.resolve({
            error: {
              status: 'UNAVAILABLE',
              errors: [{ reason: 'backendError', message: 'private' }],
              message: 'private',
            },
          }),
      }),
    );
    const adapter = new GoogleSheetsAdapter('test');
    await expect(adapter.appendRow('file', 'Sheet', [1])).rejects.toMatchObject({
      outcomeUnknown: true,
      retryable: true,
      providerDiagnostic: { httpStatus: 503, status: 'UNAVAILABLE', reason: 'backendError' },
    });
  });
  it('drops arbitrary diagnostic strings and does not infer unsupported format from 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: { status: 'private token', errors: [{ reason: 'private contents' }] },
          }),
      }),
    );
    await expect(new GoogleSheetsAdapter('test').getHeaders('file', 'Sheet')).rejects.toMatchObject(
      { code: 'STRUCTURE_ERROR', providerDiagnostic: { httpStatus: 400 } },
    );
  });
});

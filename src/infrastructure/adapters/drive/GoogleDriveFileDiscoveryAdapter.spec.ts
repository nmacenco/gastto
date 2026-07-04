// LAYER: Infrastructure / Tests
// Contract tests for GoogleDriveFileDiscoveryAdapter.
// Mocks the global fetch API so no real Google calls are made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';
import { GoogleDriveFileDiscoveryAdapter } from './GoogleDriveFileDiscoveryAdapter';
import { CloudFile } from '../../../domain/entities/CloudFile';
import { FileDiscoveryError } from '../../../domain/errors/FileDiscoveryError';
import { InvalidProviderError } from '../../../domain/errors/InvalidProviderError';

describe('GoogleDriveFileDiscoveryAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let adapter: GoogleDriveFileDiscoveryAdapter;
  const mockLoggerError = vi.fn();
  const mockLogger = { error: mockLoggerError } as unknown as Logger;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    adapter = new GoogleDriveFileDiscoveryAdapter(mockLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listRecentSpreadsheets', () => {
    it('returns CloudFile array on successful response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            files: [
              {
                id: 'file-1',
                name: 'Budget 2024',
                mimeType: 'application/vnd.google-apps.spreadsheet',
                modifiedTime: '2024-01-15T10:30:00.000Z',
              },
              {
                id: 'file-2',
                name: 'Expenses.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                modifiedTime: '2024-01-14T08:00:00.000Z',
              },
            ],
          }),
      });

      const result = await adapter.listRecentSpreadsheets('access-token-123', 'google');

      expect(result).toHaveLength(2);
      const first = result[0];
      if (!first) throw new Error('Expected first to be defined');
      expect(first).toBeInstanceOf(CloudFile);
      expect(first.id).toBe('file-1');
      expect(first.name).toBe('Budget 2024');
      expect(first.mimeType).toBe('application/vnd.google-apps.spreadsheet');
      expect(first.modifiedAt).toEqual(new Date('2024-01-15T10:30:00.000Z'));

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://www.googleapis.com/drive/v3/files');
      expect(url).toContain('orderBy=modifiedTime+desc');
      expect(url).toContain('pageSize=5');
      expect(url).toContain('fields=files%28id%2Cname%2CmimeType%2CmodifiedTime%29');
      expect(init.headers).toEqual({ Authorization: 'Bearer access-token-123' });

      const parsedUrl = new URL(url);
      const q = parsedUrl.searchParams.get('q');
      expect(q).toContain("mimeType = 'application/vnd.google-apps.spreadsheet'");
      expect(q).toContain('or');
      expect(q).toContain(
        "mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
      );
      expect(q).toContain("mimeType = 'application/vnd.oasis.opendocument.spreadsheet'");
    });

    it('returns empty array when no files found', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ files: [] }),
      });

      const result = await adapter.listRecentSpreadsheets('access-token-123', 'google');
      expect(result).toEqual([]);
    });

    it('throws InvalidProviderError for non-google providers', async () => {
      await expect(adapter.listRecentSpreadsheets('token', 'microsoft')).rejects.toBeInstanceOf(
        InvalidProviderError,
      );
    });

    it('throws FileDiscoveryError on non-2xx HTTP', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'unauthorized' }),
      });

      await expect(adapter.listRecentSpreadsheets('token', 'google')).rejects.toBeInstanceOf(
        FileDiscoveryError,
      );

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'GoogleDriveFileDiscovery',
          code: 'DRIVE_API_ERROR',
          status: 401,
          errorBody: { error: 'unauthorized' },
        }),
      );
    });

    it('throws FileDiscoveryError on invalid JSON response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      await expect(adapter.listRecentSpreadsheets('token', 'google')).rejects.toBeInstanceOf(
        FileDiscoveryError,
      );
    });

    it('throws FileDiscoveryError on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(adapter.listRecentSpreadsheets('token', 'google')).rejects.toBeInstanceOf(
        FileDiscoveryError,
      );
    });
  });

  describe('searchSpreadsheets', () => {
    it('returns filtered CloudFile array on successful response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            files: [
              {
                id: 'file-3',
                name: 'Monthly Budget',
                mimeType: 'application/vnd.google-apps.spreadsheet',
                modifiedTime: '2024-01-10T12:00:00.000Z',
              },
            ],
          }),
      });

      const result = await adapter.searchSpreadsheets('token', 'google', 'Budget');

      expect(result).toHaveLength(1);
      const first = result[0];
      if (!first) throw new Error('Expected first to be defined');
      expect(first.name).toBe('Monthly Budget');

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('name+contains+%27Budget%27');

      const parsedUrl = new URL(url);
      const q = parsedUrl.searchParams.get('q');
      expect(q).toContain("mimeType = 'application/vnd.google-apps.spreadsheet'");
      expect(q).toContain('or');
      expect(q).toContain("name contains 'Budget'");
    });

    it('throws InvalidProviderError for non-google providers', async () => {
      await expect(
        adapter.searchSpreadsheets('token', 'microsoft', 'query'),
      ).rejects.toBeInstanceOf(InvalidProviderError);
    });
  });

  describe('validateFileAccess', () => {
    it('returns true on HTTP 200', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await adapter.validateFileAccess('file-123', 'token', 'google');
      expect(result).toBe(true);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://www.googleapis.com/drive/v3/files/file-123?fields=id');
      expect(init.headers).toEqual({ Authorization: 'Bearer token' });
    });

    it('returns false on HTTP 403', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
      });

      const result = await adapter.validateFileAccess('file-123', 'token', 'google');
      expect(result).toBe(false);
    });

    it('returns false on HTTP 404', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await adapter.validateFileAccess('file-123', 'token', 'google');
      expect(result).toBe(false);
    });

    it('throws InvalidProviderError for non-google providers', async () => {
      await expect(
        adapter.validateFileAccess('file-123', 'token', 'microsoft'),
      ).rejects.toBeInstanceOf(InvalidProviderError);
    });

    it('throws FileDiscoveryError on unexpected HTTP error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'internal_error' }),
      });

      await expect(
        adapter.validateFileAccess('file-123', 'token', 'google'),
      ).rejects.toBeInstanceOf(FileDiscoveryError);

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'GoogleDriveFileDiscovery',
          code: 'DRIVE_API_ERROR',
          status: 500,
          errorBody: { error: 'internal_error' },
        }),
      );
    });

    it('throws FileDiscoveryError on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        adapter.validateFileAccess('file-123', 'token', 'google'),
      ).rejects.toBeInstanceOf(FileDiscoveryError);
    });
  });
});

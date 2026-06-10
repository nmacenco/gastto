// LAYER: Infrastructure
// Google Drive file discovery adapter. Uses direct fetch calls to Google Drive API v3.
// Does not depend on googleapis SDK to keep the dependency surface minimal.

import type { CloudStoragePort } from '../../../domain/ports/cloudStorage';
import type { SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import { CloudFile } from '../../../domain/entities/CloudFile';
import { FileDiscoveryError } from '../../../domain/errors/FileDiscoveryError';
import { InvalidProviderError } from '../../../domain/errors/InvalidProviderError';

const GOOGLE_DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';

const SPREADSHEET_MIME_TYPES = [
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
];

function buildMimeTypeQuery(): string {
  return SPREADSHEET_MIME_TYPES.map((type) => `mimeType = '${type}'`).join(' or ');
}

export class GoogleDriveFileDiscoveryAdapter implements CloudStoragePort {
  async listRecentSpreadsheets(
    accessToken: string,
    provider: SpreadsheetProvider,
  ): Promise<CloudFile[]> {
    if (provider !== 'google') {
      throw new InvalidProviderError(provider);
    }

    const params = new URLSearchParams({
      q: buildMimeTypeQuery(),
      orderBy: 'modifiedTime desc',
      pageSize: '5',
      fields: 'files(id,name,mimeType,modifiedTime)',
    });

    return this.fetchFiles(`${GOOGLE_DRIVE_API_URL}?${params.toString()}`, accessToken);
  }

  async searchSpreadsheets(
    accessToken: string,
    provider: SpreadsheetProvider,
    query: string,
  ): Promise<CloudFile[]> {
    if (provider !== 'google') {
      throw new InvalidProviderError(provider);
    }

    const params = new URLSearchParams({
      q: `${buildMimeTypeQuery()} and name contains '${query}'`,
      orderBy: 'modifiedTime desc',
      pageSize: '5',
      fields: 'files(id,name,mimeType,modifiedTime)',
    });

    return this.fetchFiles(`${GOOGLE_DRIVE_API_URL}?${params.toString()}`, accessToken);
  }

  async validateFileAccess(
    fileId: string,
    accessToken: string,
    provider: SpreadsheetProvider,
  ): Promise<boolean> {
    if (provider !== 'google') {
      throw new InvalidProviderError(provider);
    }

    const url = `${GOOGLE_DRIVE_API_URL}/${fileId}?fields=id`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      throw new FileDiscoveryError(`Network error during file access validation: ${String(err)}`);
    }

    if (response.status === 200) {
      return true;
    }

    if (response.status === 403 || response.status === 404) {
      return false;
    }

    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = 'Could not parse error body';
    }
    console.error({
      endpoint: 'GoogleDriveFileDiscovery',
      code: 'DRIVE_API_ERROR',
      status: response.status,
      errorBody,
    });
    throw new FileDiscoveryError(
      `Google Drive API error during file access validation: HTTP ${response.status}`,
    );
  }

  private async fetchFiles(url: string, accessToken: string): Promise<CloudFile[]> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      throw new FileDiscoveryError(`Network error during file discovery: ${String(err)}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new FileDiscoveryError(
        `Invalid JSON response from Google Drive API: HTTP ${response.status}`,
      );
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = 'Could not parse error body';
      }
      console.error({
        endpoint: 'GoogleDriveFileDiscovery',
        code: 'DRIVE_API_ERROR',
        status: response.status,
        errorBody,
      });
      throw new FileDiscoveryError(
        `Google Drive API error during file discovery: HTTP ${response.status}`,
      );
    }

    return parseFilesResponse(data);
  }
}

function parseFilesResponse(data: unknown): CloudFile[] {
  if (typeof data !== 'object' || data === null || !('files' in data)) {
    throw new FileDiscoveryError('Unexpected response format from Google Drive API');
  }

  const files = (data as Record<string, unknown>).files;
  if (!Array.isArray(files)) {
    throw new FileDiscoveryError('Unexpected response format from Google Drive API');
  }

  return files.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new FileDiscoveryError('Invalid file item in Google Drive API response');
    }

    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : '';
    const name = typeof obj.name === 'string' ? obj.name : '';
    const mimeType = typeof obj.mimeType === 'string' ? obj.mimeType : '';
    const modifiedTime = typeof obj.modifiedTime === 'string' ? obj.modifiedTime : '';

    if (!id || !name || !mimeType || !modifiedTime) {
      throw new FileDiscoveryError('Invalid file item in Google Drive API response');
    }

    return new CloudFile({
      id,
      name,
      mimeType,
      modifiedAt: new Date(modifiedTime),
    });
  });
}

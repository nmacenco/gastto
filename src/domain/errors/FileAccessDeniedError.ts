// LAYER: Domain
// Error thrown when the user does not have access to a requested file
// (e.g., HTTP 403 or 404 from the cloud storage provider).

export class FileAccessDeniedError extends Error {
  constructor(message: string = 'Access to the requested file was denied') {
    super(message);
    this.name = 'FileAccessDeniedError';
  }
}

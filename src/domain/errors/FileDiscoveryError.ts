// LAYER: Domain
// Error thrown when a file discovery operation fails (e.g., API error,
// network failure, or unexpected response from the cloud storage provider).

export class FileDiscoveryError extends Error {
  constructor(message: string = 'Failed to discover files in cloud storage') {
    super(message);
    this.name = 'FileDiscoveryError';
  }
}

// LAYER: Domain
// Error thrown when a spreadsheet operation fails (e.g., API error,
// network failure, or unexpected response from the spreadsheet provider).

export class SpreadsheetError extends Error {
  constructor(message: string = 'Failed to perform spreadsheet operation') {
    super(message);
    this.name = 'SpreadsheetError';
  }
}

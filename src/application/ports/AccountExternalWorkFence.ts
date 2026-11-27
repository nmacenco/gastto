// LAYER: Application
// Holds account activity across an external effect and its local finalization.
export interface AccountExternalWorkFence {
  run<T>(userId: string, work: () => Promise<T>): Promise<T>;
}

export class AccountDeletionInProgressError extends Error {
  constructor() {
    super('ACCOUNT_DELETION_IN_PROGRESS');
    this.name = 'AccountDeletionInProgressError';
  }
}

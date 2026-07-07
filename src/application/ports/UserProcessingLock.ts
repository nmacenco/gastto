// LAYER: Application
// Port for per-user processing lock used by the thick worker
// to serialize process-message jobs for the same user.

export interface IUserProcessingLock {
  acquire(userId: string, ttlMs: number): Promise<boolean>;
  release(userId: string): Promise<void>;
}

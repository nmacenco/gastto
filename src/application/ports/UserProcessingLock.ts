// LAYER: Application
// Port for per-user processing lock used by the thick worker
// to serialize process-message jobs for the same user.
// Acquire returns a unique token that must be passed back to release
// so a job can only delete the lock it owns (safety net for TTL expiry).

export interface IUserProcessingLock {
  acquire(userId: string, ttlMs: number): Promise<string | null>;
  renew(userId: string, token: string, ttlMs: number): Promise<boolean>;
  release(userId: string, token: string): Promise<void>;
}

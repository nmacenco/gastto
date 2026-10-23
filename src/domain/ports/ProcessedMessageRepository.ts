// LAYER: Domain
// Repository port for idempotent message tracking.
// Implementations decide the storage backend (e.g. Redis, SQL) while the domain
// only cares about the contract: a key exists or has been processed.

import type { ProcessedMessageKey } from '../value-objects/ProcessedMessageKey';

export interface IProcessedMessageRepository {
  exists(key: ProcessedMessageKey): Promise<boolean>;
  markAsProcessed(key: ProcessedMessageKey): Promise<void>;
}

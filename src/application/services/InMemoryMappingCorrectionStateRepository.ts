// LAYER: Application
// In-memory implementation of IMappingCorrectionStateRepository.
// Useful for unit tests and as a temporary stand-in until the Redis adapter
// (Phase 5) is wired into production.

import type {
  IMappingCorrectionStateRepository,
  MappingCorrectionStateSnapshot,
} from '../../domain/ports/repositories';

export class InMemoryMappingCorrectionStateRepository implements IMappingCorrectionStateRepository {
  private readonly store = new Map<string, MappingCorrectionStateSnapshot>();

  save(
    userId: string,
    state: MappingCorrectionStateSnapshot,
    _ttlSeconds: number,
  ): Promise<void> {
    this.store.set(userId, state);
    return Promise.resolve();
  }

  load(userId: string): Promise<MappingCorrectionStateSnapshot | null> {
    return Promise.resolve(this.store.get(userId) ?? null);
  }

  clear(userId: string): Promise<void> {
    this.store.delete(userId);
    return Promise.resolve();
  }
}

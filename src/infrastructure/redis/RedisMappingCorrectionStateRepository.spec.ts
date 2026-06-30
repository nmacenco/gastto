// LAYER: Infrastructure / Tests
// Unit tests for RedisMappingCorrectionStateRepository.
// Mocks the ioredis client interface; no real Redis connection is used.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisMappingCorrectionStateRepository } from './RedisMappingCorrectionStateRepository';
import type { MappingCorrectionStateSnapshot } from '../../domain/ports/repositories';

const mockSetex = vi.fn().mockResolvedValue('OK');
const mockGet = vi.fn().mockResolvedValue(null);
const mockDel = vi.fn().mockResolvedValue(1);

function buildMockRedis(): Redis {
  return {
    setex: mockSetex,
    get: mockGet,
    del: mockDel,
  } as unknown as Redis;
}

function buildSnapshot(overrides: Partial<MappingCorrectionStateSnapshot> = {}): MappingCorrectionStateSnapshot {
  return {
    originalMapping: [
      {
        id: 'mapping-1',
        spreadsheetId: 'config-1',
        GasttoField: 'categoria',
        columnIndex: 2,
        columnHeader: 'Categoría',
        inferred: true,
        confirmedAt: null,
      },
    ],
    corrections: [
      {
        field: 'categoria',
        columnIndex: 4,
        columnHeader: 'Rubro',
      },
    ],
    status: 'correcting',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RedisMappingCorrectionStateRepository', () => {
  it('serializes and saves the state with the provided TTL', async () => {
    const redis = buildMockRedis();
    const repo = new RedisMappingCorrectionStateRepository(redis);
    const snapshot = buildSnapshot();

    await repo.save('user-123', snapshot, 1800);

    expect(mockSetex).toHaveBeenCalledWith(
      'conversation:user-123:mapping-correction',
      1800,
      JSON.stringify(snapshot),
    );
  });

  it('deserializes the stored snapshot on load', async () => {
    const snapshot = buildSnapshot();
    mockGet.mockResolvedValue(JSON.stringify(snapshot));

    const redis = buildMockRedis();
    const repo = new RedisMappingCorrectionStateRepository(redis);

    const result = await repo.load('user-123');

    expect(mockGet).toHaveBeenCalledWith('conversation:user-123:mapping-correction');
    expect(result).toEqual(snapshot);
  });

  it('returns null when the key is missing', async () => {
    mockGet.mockResolvedValue(null);

    const redis = buildMockRedis();
    const repo = new RedisMappingCorrectionStateRepository(redis);

    const result = await repo.load('user-123');

    expect(result).toBeNull();
  });

  it('returns null when the stored JSON is malformed', async () => {
    mockGet.mockResolvedValue('not-json');

    const redis = buildMockRedis();
    const repo = new RedisMappingCorrectionStateRepository(redis);

    const result = await repo.load('user-123');

    expect(result).toBeNull();
  });

  it('deletes the correction state key', async () => {
    const redis = buildMockRedis();
    const repo = new RedisMappingCorrectionStateRepository(redis);

    await repo.clear('user-123');

    expect(mockDel).toHaveBeenCalledWith('conversation:user-123:mapping-correction');
  });
});

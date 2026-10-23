// LAYER: Application / Tests
// Contract tests for ICategoryFallbackMapper.
// Verifies the output port accepts a canonical category and available user categories.

import { describe, it, expect, vi } from 'vitest';
import type { ICategoryFallbackMapper } from './categoryFallbackMapper.port';

describe('ICategoryFallbackMapper contract', () => {
  it('returns the closest user category for a canonical category', async () => {
    const mockFindClosest = vi.fn().mockResolvedValue('Ocio');
    const port: ICategoryFallbackMapper = { findClosest: mockFindClosest };

    const result = await port.findClosest('entertainment', ['Comida', 'Ocio', 'Transporte']);

    expect(mockFindClosest).toHaveBeenCalledWith('entertainment', ['Comida', 'Ocio', 'Transporte']);
    expect(result).toBe('Ocio');
  });

  it('returns null when no close match exists', async () => {
    const mockFindClosest = vi.fn().mockResolvedValue(null);
    const port: ICategoryFallbackMapper = { findClosest: mockFindClosest };

    const result = await port.findClosest('entertainment', ['Comida']);

    expect(result).toBeNull();
  });

  it('has the correct method signature', () => {
    const mockFindClosest = vi.fn().mockResolvedValue(null);
    const port: ICategoryFallbackMapper = { findClosest: mockFindClosest };

    expect(typeof port.findClosest).toBe('function');
  });
});

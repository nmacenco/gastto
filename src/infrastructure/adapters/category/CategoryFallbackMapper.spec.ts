// LAYER: Infrastructure / Tests
// Unit tests for CategoryFallbackMapper.

import { describe, it, expect } from 'vitest';
import { CategoryFallbackMapper } from './CategoryFallbackMapper';
import type { CanonicalCategory } from '../../../domain/value-objects/CategoryKeywordVocabulary';

async function findClosest(
  inferred: CanonicalCategory,
  available: readonly string[],
): Promise<string | null> {
  const mapper = new CategoryFallbackMapper();
  return mapper.findClosest(inferred, available);
}

describe('CategoryFallbackMapper', () => {
  it('returns an exact canonical display-name match preserving original casing', async () => {
    const result = await findClosest('food', ['Comida', 'Transporte']);
    expect(result).toBe('Comida');
  });

  it('returns a substring match when the available category contains a canonical name', async () => {
    const result = await findClosest('health', ['Gastos Médicos', 'Transporte']);
    expect(result).toBe('Gastos Médicos');
  });

  it('returns a substring match when the canonical name contains the available category', async () => {
    const result = await findClosest('transport', ['Movil']);
    expect(result).toBe('Movil');
  });

  it('returns a Levenshtein match below the threshold', async () => {
    const result = await findClosest('entertainment', ['Ocui', 'Servicios']);
    expect(result).toBe('Ocui');
  });

  it('returns null when no reasonable match exists', async () => {
    const result = await findClosest('housing', ['Comida', 'Transporte']);
    expect(result).toBeNull();
  });

  it('returns null when no categories are available', async () => {
    const result = await findClosest('food', []);
    expect(result).toBeNull();
  });
});

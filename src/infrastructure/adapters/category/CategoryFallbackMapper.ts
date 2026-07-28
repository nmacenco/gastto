// LAYER: Infrastructure
// Deterministic fallback mapper that finds the closest user category when the
// inferred canonical category is not present in the user's spreadsheet.
// Strategy: exact display-name match, normalized substring containment,
// then Levenshtein distance under a conservative threshold.

import type { ICategoryFallbackMapper } from '../../../application/ports/output/categoryFallbackMapper.port';
import type { CanonicalCategory } from '../../../domain/value-objects/CategoryKeywordVocabulary';

const CANONICAL_DISPLAY_NAMES: Readonly<Record<CanonicalCategory, readonly string[]>> = {
  food: ['comida', 'alimentacion', 'alimento', 'alimentos'],
  transport: ['transporte', 'transport', 'movilidad'],
  housing: ['vivienda', 'casa', 'hogar', 'alquiler'],
  health: ['salud', 'medico', 'medicina'],
  entertainment: ['ocio', 'entretenimiento', 'diversion'],
  services: ['servicios', 'servicio'],
};

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previousRow = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const insertion = currentRow[j - 1]! + 1;
      const deletion = previousRow[j]! + 1;
      const substitution = previousRow[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      currentRow[j] = Math.min(insertion, deletion, substitution);
    }
    for (let j = 0; j <= b.length; j++) {
      previousRow[j] = currentRow[j]!;
    }
  }

  return previousRow[b.length]!;
}

function isCloseEnough(distance: number, a: string, b: string): boolean {
  const minLength = Math.min(a.length, b.length);
  if (minLength <= 2) return distance === 0;
  return distance <= Math.min(3, Math.ceil(minLength / 3)) && distance < minLength;
}

export class CategoryFallbackMapper implements ICategoryFallbackMapper {
  findClosest(inferred: CanonicalCategory, available: readonly string[]): Promise<string | null> {
    if (available.length === 0) {
      return Promise.resolve(null);
    }

    const displayNames = CANONICAL_DISPLAY_NAMES[inferred];
    const normalizedAvailable = available.map((category) => ({
      original: category,
      normalized: normalize(category),
    }));

    // 1. Exact match against canonical display names.
    for (const displayName of displayNames) {
      const normalizedDisplayName = normalize(displayName);
      for (const candidate of normalizedAvailable) {
        if (candidate.normalized === normalizedDisplayName) {
          return Promise.resolve(candidate.original);
        }
      }
    }

    // 2. Normalized substring containment in either direction.
    for (const displayName of displayNames) {
      const normalizedDisplayName = normalize(displayName);
      for (const candidate of normalizedAvailable) {
        if (
          candidate.normalized.includes(normalizedDisplayName) ||
          normalizedDisplayName.includes(candidate.normalized)
        ) {
          return Promise.resolve(candidate.original);
        }
      }
    }

    // 3. Best Levenshtein match under a conservative threshold.
    let bestCandidate: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const displayName of displayNames) {
      const normalizedDisplayName = normalize(displayName);
      for (const candidate of normalizedAvailable) {
        const distance = levenshteinDistance(normalizedDisplayName, candidate.normalized);
        if (isCloseEnough(distance, normalizedDisplayName, candidate.normalized)) {
          if (distance < bestDistance) {
            bestDistance = distance;
            bestCandidate = candidate.original;
          }
        }
      }
    }

    return Promise.resolve(bestCandidate);
  }
}

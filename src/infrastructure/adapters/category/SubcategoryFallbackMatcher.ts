// LAYER: Infrastructure
// Conservative deterministic matcher for user-defined subcategory names.

import type { ISubcategoryFallbackMatcher } from '../../../application/ports/output/subcategoryFallbackMatcher.port';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function distance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    let diagonal = previous[0]!;
    previous[0] = row;
    for (let column = 1; column <= right.length; column++) {
      const above = previous[column]!;
      previous[column] = Math.min(
        previous[column]! + 1,
        previous[column - 1]! + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length]!;
}

export class SubcategoryFallbackMatcher implements ISubcategoryFallbackMatcher {
  findClosest(input: string, candidates: readonly string[]): string | null {
    const normalizedInput = normalize(input);
    if (normalizedInput.length < 4 || candidates.length === 0) return null;

    const ranked = candidates
      .map((candidate) => {
        const normalizedCandidate = normalize(candidate);
        return {
          candidate,
          distance: distance(normalizedInput, normalizedCandidate),
          length: normalizedCandidate.length,
        };
      })
      .sort((left, right) => left.distance - right.distance);

    const best = ranked[0];
    if (!best) return null;
    const threshold = Math.min(2, Math.floor(Math.min(normalizedInput.length, best.length) / 4));
    if (best.distance > threshold || ranked[1]?.distance === best.distance) return null;
    return best.candidate;
  }
}

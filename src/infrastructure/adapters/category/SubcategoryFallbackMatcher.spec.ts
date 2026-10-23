// LAYER: Infrastructure / Tests

import { describe, expect, it } from 'vitest';
import { SubcategoryFallbackMatcher } from './SubcategoryFallbackMatcher';

describe('SubcategoryFallbackMatcher', () => {
  const matcher = new SubcategoryFallbackMatcher();

  it('returns a unique conservative approximate match', () => {
    expect(matcher.findClosest('Restauran', ['Restaurant', 'Supermarket'])).toBe('Restaurant');
  });

  it('returns no result for absent, tied, or over-threshold candidates', () => {
    expect(matcher.findClosest('', ['Restaurant'])).toBeNull();
    expect(matcher.findClosest('abcd', ['abce', 'abcf'])).toBeNull();
    expect(matcher.findClosest('streaming', ['Restaurant', 'Supermarket'])).toBeNull();
  });
});

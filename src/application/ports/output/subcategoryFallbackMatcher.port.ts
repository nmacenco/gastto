// LAYER: Application
// Conservative arbitrary-name matcher used only after exact child evidence fails.

export interface ISubcategoryFallbackMatcher {
  findClosest(input: string, candidates: readonly string[]): string | null;
}

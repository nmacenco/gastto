// LAYER: Application
// Deterministic fallback/normalizer for expense category classification.
// Runs after the LLM extractor (primary path) and resolves categories from
// free-text keywords with confidence, ambiguity, and fallback handling.

import type {
  ICategoryClassifier,
  ClassifyExpenseCategoryInput,
} from '../../ports/in/categoryClassifier.port';
import type { ICategoryKeywordVocabularyRepository } from '../../ports/output/categoryKeywordVocabularyRepository.port';
import type { ICategoryFallbackMapper } from '../../ports/output/categoryFallbackMapper.port';
import type { CanonicalCategory } from '../../../domain/value-objects/CategoryKeywordVocabulary';
import { ClassificationResult } from '../../../domain/value-objects/ClassificationResult';

export class ClassifyExpenseCategory implements ICategoryClassifier {
  constructor(
    private readonly vocabularyRepo: ICategoryKeywordVocabularyRepository,
    private readonly fallbackMapper: ICategoryFallbackMapper,
    private readonly confidenceThreshold: number,
  ) {}

  async execute(input: ClassifyExpenseCategoryInput): Promise<ClassificationResult> {
    const vocabulary = await this.vocabularyRepo.findByUserId(input.userId);
    const userCategories = vocabulary.getUserCategories();

    if (
      input.llmCategory !== null &&
      input.llmConfidence === 'alta' &&
      this.categoryExistsInUserVocabulary(input.llmCategory, userCategories)
    ) {
      const resolvedName = this.resolveUserCategoryName(input.llmCategory, userCategories);
      return ClassificationResult.highConfidence(resolvedName ?? input.llmCategory);
    }

    const { scores, totalTokens } = vocabulary.findAllMatches(input.rawMessage);
    const sorted = this.sortScores(scores);

    if (sorted.length === 0 || totalTokens === 0 || sorted[0]![1] === 0) {
      return ClassificationResult.noMatch();
    }

    const [topCanonical, topScore] = sorted[0]!;
    const secondScore = sorted[1]?.[1] ?? 0;
    const topConfidence = topScore / totalTokens;
    const gap = (topScore - secondScore) / totalTokens;

    const userCategoryName = vocabulary.getUserCategoryNames(topCanonical)[0] ?? null;
    const resolvedCategory =
      userCategoryName ?? (await this.fallbackMapper.findClosest(topCanonical, userCategories));

    if (resolvedCategory === null) {
      return ClassificationResult.noMatch();
    }

    if (userCategoryName === null) {
      return ClassificationResult.fallback(resolvedCategory);
    }

    if (topConfidence >= this.confidenceThreshold && gap >= this.confidenceThreshold) {
      return ClassificationResult.highConfidence(resolvedCategory);
    }

    return ClassificationResult.ambiguous(resolvedCategory);
  }

  private categoryExistsInUserVocabulary(
    rawCategory: string,
    userCategories: readonly string[],
  ): boolean {
    const normalized = rawCategory.toLowerCase().trim();
    return userCategories.some((c) => c.toLowerCase().trim() === normalized);
  }

  private resolveUserCategoryName(
    rawCategory: string,
    userCategories: readonly string[],
  ): string | null {
    const normalized = rawCategory.toLowerCase().trim();
    return (
      userCategories.find((c) => c.toLowerCase().trim() === normalized) ??
      this.findUserCategoryByKeyword(normalized, userCategories)
    );
  }

  private findUserCategoryByKeyword(
    keyword: string,
    userCategories: readonly string[],
  ): string | null {
    return (
      userCategories.find((c) => {
        const normalizedCategory = c.toLowerCase().trim();
        return normalizedCategory.includes(keyword) || keyword.includes(normalizedCategory);
      }) ?? null
    );
  }

  private sortScores(
    scores: ReadonlyMap<CanonicalCategory, number>,
  ): [CanonicalCategory, number][] {
    return [...scores.entries()]
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1]);
  }
}

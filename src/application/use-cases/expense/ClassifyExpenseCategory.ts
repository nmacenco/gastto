// LAYER: Application
// Resolves an active category first, then classifies only within that parent's children.

import type {
  ICategoryClassifier,
  ClassifyExpenseCategoryInput,
} from '../../ports/in/categoryClassifier.port';
import type { ICategoryKeywordVocabularyRepository } from '../../ports/output/categoryKeywordVocabularyRepository.port';
import type { ICategoryFallbackMapper } from '../../ports/output/categoryFallbackMapper.port';
import type { ISubcategoryFallbackMatcher } from '../../ports/output/subcategoryFallbackMatcher.port';
import type { ICategoryVocabularyRepository } from '../../../domain/ports/repositories';
import type { Category } from '../../../domain/entities/Category';
import type { Subcategory } from '../../../domain/entities/Subcategory';
import type { CategoryConfidence } from '../../../domain/entities/ExpenseRecord';
import {
  ClassificationSelection,
  HierarchicalClassificationResult,
  SubcategoryClassificationSelection,
  type ClassificationSelection as ClassificationSelectionValue,
  type HierarchicalClassificationResult as HierarchicalClassificationResultValue,
  type SubcategoryClassificationSelection as SubcategoryClassificationSelectionValue,
} from '../../../domain/value-objects/ClassificationResult';

interface CategoryCandidate {
  name: string;
  status: 'confirmed' | 'ambiguous' | 'fallback';
  confidence: CategoryConfidence;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export class ClassifyExpenseCategory implements ICategoryClassifier {
  constructor(
    private readonly keywordVocabularyRepo: ICategoryKeywordVocabularyRepository,
    private readonly hierarchyRepo: ICategoryVocabularyRepository,
    private readonly categoryFallbackMapper: ICategoryFallbackMapper,
    private readonly subcategoryFallbackMatcher: ISubcategoryFallbackMatcher,
    private readonly confidenceThreshold: number,
  ) {}

  async execute(
    input: ClassifyExpenseCategoryInput,
  ): Promise<HierarchicalClassificationResultValue> {
    if (input.spreadsheetId === null) return HierarchicalClassificationResult.none();

    const [keywordVocabulary, hierarchy] = await Promise.all([
      this.keywordVocabularyRepo.findByUserId(input.userId),
      this.hierarchyRepo.findBySpreadsheetId(input.spreadsheetId),
    ]);
    if (hierarchy === null) return HierarchicalClassificationResult.none();

    const activeCategories = hierarchy.getCategories();
    const categoryCandidate = await this.classifyCategory(
      input,
      keywordVocabulary,
      activeCategories,
    );
    const category = this.bindCategory(categoryCandidate, activeCategories);
    if (category.id === null) return HierarchicalClassificationResult.create(category);

    const subcategory = this.classifySubcategory(
      input,
      category.id,
      hierarchy.getSubcategories(category.id),
    );
    return HierarchicalClassificationResult.create(category, subcategory);
  }

  private async classifyCategory(
    input: ClassifyExpenseCategoryInput,
    vocabulary: Awaited<ReturnType<ICategoryKeywordVocabularyRepository['findByUserId']>>,
    activeCategories: readonly Category[],
  ): Promise<CategoryCandidate | null> {
    const userCategories = vocabulary.getUserCategories();
    if (input.llmCategory !== null && input.llmConfidence === 'alta') {
      const exact = activeCategories.find(
        (category) => normalize(category.name) === normalize(input.llmCategory!),
      );
      if (exact) return { name: exact.name, status: 'confirmed', confidence: 'alta' };
    }

    const { scores, totalTokens } = vocabulary.findAllMatches(input.rawMessage);
    const sorted = [...scores.entries()]
      .filter(([, score]) => score > 0)
      .sort((left, right) => right[1] - left[1]);
    if (sorted.length === 0 || totalTokens === 0) return null;

    const [topCanonical, topScore] = sorted[0]!;
    const secondScore = sorted[1]?.[1] ?? 0;
    const userCategoryName = vocabulary.getUserCategoryNames(topCanonical)[0] ?? null;
    const resolvedName =
      userCategoryName ??
      (await this.categoryFallbackMapper.findClosest(topCanonical, userCategories));
    if (resolvedName === null) return null;
    if (userCategoryName === null) {
      return { name: resolvedName, status: 'fallback', confidence: 'baja' };
    }

    const topConfidence = topScore / totalTokens;
    const gap = (topScore - secondScore) / totalTokens;
    return topConfidence >= this.confidenceThreshold && gap >= this.confidenceThreshold
      ? { name: resolvedName, status: 'confirmed', confidence: 'alta' }
      : { name: resolvedName, status: 'ambiguous', confidence: 'baja' };
  }

  private bindCategory(
    candidate: CategoryCandidate | null,
    activeCategories: readonly Category[],
  ): ClassificationSelectionValue {
    if (candidate === null) return ClassificationSelection.none();
    const category = activeCategories.find(
      (active) => normalize(active.name) === normalize(candidate.name),
    );
    if (!category) return ClassificationSelection.none();

    switch (candidate.status) {
      case 'confirmed':
        return ClassificationSelection.confirmed(category.id, category.name, candidate.confidence);
      case 'ambiguous':
        return ClassificationSelection.ambiguous(category.id, category.name, candidate.confidence);
      case 'fallback':
        return ClassificationSelection.fallback(category.id, category.name, candidate.confidence);
    }
  }

  private classifySubcategory(
    input: ClassifyExpenseCategoryInput,
    categoryId: string,
    candidates: readonly Subcategory[],
  ): SubcategoryClassificationSelectionValue {
    if (input.llmSubcategory !== null && input.llmSubcategoryConfidence === 'alta') {
      const exact = candidates.find(
        (candidate) => normalize(candidate.name) === normalize(input.llmSubcategory!),
      );
      if (exact) {
        return SubcategoryClassificationSelection.confirmed(
          exact.id,
          exact.name,
          categoryId,
          input.llmSubcategoryConfidence,
        );
      }
    }

    const message = ` ${normalize(input.rawMessage)} `;
    const phraseMatches = candidates.filter((candidate) =>
      message.includes(` ${normalize(candidate.name)} `),
    );
    if (phraseMatches.length === 1) {
      const match = phraseMatches[0]!;
      return SubcategoryClassificationSelection.confirmed(match.id, match.name, categoryId);
    }
    if (phraseMatches.length > 1) {
      const match = phraseMatches[0]!;
      return SubcategoryClassificationSelection.ambiguous(match.id, match.name, categoryId);
    }

    const fallback = this.findSubcategoryFallback(input, candidates);
    if (fallback) {
      return SubcategoryClassificationSelection.fallback(fallback.id, fallback.name, categoryId);
    }
    return SubcategoryClassificationSelection.none();
  }

  private findSubcategoryFallback(
    input: ClassifyExpenseCategoryInput,
    candidates: readonly Subcategory[],
  ): Subcategory | null {
    const names = candidates.map((candidate) => candidate.name);
    const evidence = input.llmSubcategory
      ? [input.llmSubcategory]
      : normalize(input.rawMessage)
          .split(' ')
          .filter((token) => token.length >= 4);
    const matches = new Set(
      evidence
        .map((value) => this.subcategoryFallbackMatcher.findClosest(value, names))
        .filter((value): value is string => value !== null),
    );
    if (matches.size !== 1) return null;
    const [name] = matches;
    return candidates.find((candidate) => candidate.name === name) ?? null;
  }
}

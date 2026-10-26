import type { ConversationStatePrecondition } from '../../domain/entities/ConversationState';
import type { CategoryOnboardingCategory } from '../dtos/CategoryOnboardingState';
import type { Category } from '../../domain/entities/Category';
import type { Subcategory } from '../../domain/entities/Subcategory';

export interface OnboardingVocabularyCommit {
  execute(input: {
    userId: string;
    expected: ConversationStatePrecondition;
    sourceConfigId: string;
    categories: CategoryOnboardingCategory[];
    paymentMethods: string[];
    categoryDraft?: { categories: Category[]; subcategories: Subcategory[] };
  }): Promise<'committed' | 'stale' | 'conflict'>;
}

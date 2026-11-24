import type {
  ConversationState,
  ConversationStatePrecondition,
} from '../../domain/entities/ConversationState';
import type { ExpenseReviewPayload } from '../../domain/value-objects/expense-review-payload';
import type { ExpenseCategoryChoiceState } from '../use-cases/expense/ExpenseCategoryChoiceState';
import type { VocabularySnapshot } from './SettingsVocabularyCommit';

export interface ExpenseCategoryChoiceCommit {
  load(spreadsheetId: string): Promise<VocabularySnapshot>;
  execute(input: {
    userId: string;
    expected: ConversationStatePrecondition;
    choice: ExpenseCategoryChoiceState;
    selected: { id: string; name: string; add: boolean };
    next: ExpenseReviewPayload;
  }): Promise<{ status: 'updated'; state: ConversationState } | { status: 'stale' | 'conflict' }>;
}

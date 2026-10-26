import type { ConversationStatePrecondition } from '../../domain/entities/ConversationState';
import type { Category } from '../../domain/entities/Category';
import type { Subcategory } from '../../domain/entities/Subcategory';
import type { PaymentMethod } from '../../domain/entities/PaymentMethodCatalog';

export interface VocabularySnapshot {
  categories: Array<Category & { isActive: boolean }>;
  subcategories: Array<Subcategory & { isActive: boolean }>;
}

export interface PaymentSnapshot {
  confirmed: boolean;
  methods: PaymentMethod[];
}

type CommitBase = {
  userId: string;
  expected: ConversationStatePrecondition;
  flowId: string;
  sourceConfigId: string;
};

export type SettingsVocabularyCommitInput = CommitBase &
  (
    | { kind: 'categories'; baseline: VocabularySnapshot; draft: VocabularySnapshot }
    | { kind: 'payment_methods'; baseline: PaymentSnapshot; draft: PaymentSnapshot }
  );

export interface SettingsVocabularyCommit {
  load(spreadsheetId: string): Promise<VocabularySnapshot>;
  loadPayments(spreadsheetId: string): Promise<PaymentSnapshot>;
  execute(input: SettingsVocabularyCommitInput): Promise<'committed' | 'stale' | 'conflict'>;
}

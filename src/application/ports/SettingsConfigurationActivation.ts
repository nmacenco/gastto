import type { ConversationStatePrecondition } from '../../domain/entities/ConversationState';
import type { GasttoField, SpreadsheetProvider } from '../../domain/entities/SpreadsheetConfig';

export interface SettingsDestinationCandidate {
  flowId: string;
  proposalId: string;
  sourceConfigId: string;
  provider: SpreadsheetProvider;
  fileId: string;
  fileName: string;
  sheetName: string;
  headerRowIndex: number;
  accessVerifiedAt: Date;
  mappings: Array<{ field: GasttoField; columnIndex: number; columnHeader: string }>;
  categories: Array<{ name: string; subcategories: string[] }>;
}

export interface SettingsConfigurationActivation {
  execute(input: {
    userId: string;
    expected: ConversationStatePrecondition;
    candidate: SettingsDestinationCandidate;
  }): Promise<'activated' | 'stale'>;
}

import type { ConversationStatePrecondition } from '../../domain/entities/ConversationState';
import type { OAuthToken } from '../../domain/entities/SpreadsheetConfig';

export interface SettingsCredentialCommitInput {
  userId: string;
  expected: ConversationStatePrecondition;
  flowId: string;
  nonce: string;
  sourceConfigId: string;
  fileId: string;
  sheetName: string;
  credential: Omit<OAuthToken, 'id'>;
}

export interface SettingsCredentialCommit {
  execute(input: SettingsCredentialCommitInput): Promise<'committed' | 'stale'>;
}

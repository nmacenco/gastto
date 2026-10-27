import type { ConversationState } from '../../../domain/entities/ConversationState';

export interface SettingsOAuthPayload extends Record<string, unknown> {
  origin: 'settings';
  flowId: string;
  provider: 'google';
  sourceConfigId: string;
  fileId: string;
  sheetName: string;
  state: string;
  reminderJobId: string;
}

export function parseSettingsOAuthPayload(
  state: ConversationState | null,
): SettingsOAuthPayload | null {
  if (state?.currentState !== 'SETTINGS_OAUTH') return null;
  const payload = state.statePayload;
  if (
    payload?.origin !== 'settings' ||
    payload.provider !== 'google' ||
    typeof payload.flowId !== 'string' ||
    !payload.flowId ||
    typeof payload.sourceConfigId !== 'string' ||
    !payload.sourceConfigId ||
    typeof payload.fileId !== 'string' ||
    !payload.fileId ||
    typeof payload.sheetName !== 'string' ||
    !payload.sheetName ||
    typeof payload.state !== 'string' ||
    !payload.state ||
    typeof payload.reminderJobId !== 'string' ||
    !payload.reminderJobId
  )
    return null;
  return payload as SettingsOAuthPayload;
}

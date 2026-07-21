// LAYER: Domain
// Normalized payload contract for incoming messages from any external channel.
// Infrastructure adapters (Telegram, WhatsApp) map their raw payloads to this
// unified shape so that the Application layer remains channel-agnostic.

import type { MessageType } from '../value-objects/MessageType';

export interface NormalizedPayload {
  readonly messageType: MessageType;
  readonly chatId: string;
  readonly userId?: string | undefined;
  readonly text?: string | undefined;
  readonly timestamp: Date;
  readonly channel: 'telegram' | 'whatsapp';
  readonly externalMessageId?: string | undefined;
  readonly rawPayload?: unknown;
}

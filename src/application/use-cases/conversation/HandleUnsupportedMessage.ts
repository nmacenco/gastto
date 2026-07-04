// LAYER: Application
// Handler invoked by the router when MessageType is UNSUPPORTED.
// Returns a friendly response to the user without leaking any internal error.

import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { sharedCopies } from '../../copies/shared.copies';

export class HandleUnsupportedMessage {
  constructor(private readonly messagingPort: MessagingOutputPort) {}

  async execute(chatId: string): Promise<void> {
    await this.messagingPort.sendMessage(chatId, sharedCopies.unsupportedMessage()).catch(() => {
      // Silently ignore send failures for unsupported messages so the
      // webhook can still respond 200 to Telegram.
    });
  }
}

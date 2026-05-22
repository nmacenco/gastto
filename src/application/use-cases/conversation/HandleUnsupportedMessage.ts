// LAYER: Application
// Handler invoked by the router when MessageType is UNSUPPORTED.
// Returns a friendly response to the user without leaking any internal error.

import type { MessagingPort } from '../../../domain/ports/services';

export const UNSUPPORTED_MESSAGE_COPY =
  'For now I only process text messages. Tell me about your expense by typing it.';

export class HandleUnsupportedMessage {
  constructor(private readonly messagingPort: MessagingPort) {}

  async execute(chatId: string): Promise<void> {
    await this.messagingPort.sendMessage(chatId, UNSUPPORTED_MESSAGE_COPY).catch(() => {
      // Silently ignore send failures for unsupported messages so the
      // webhook can still respond 200 to Telegram.
    });
  }
}

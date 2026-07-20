// LAYER: Application
// Use case that sends a friendly guidance message when a non-financial
// text message is received. Keeps the Application layer channel-agnostic
// by depending only on the MessagingOutputPort.

import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { sharedCopies } from '../../copies/shared.copies';

export class SendExpenseGuidance {
  constructor(private readonly messagingPort: MessagingOutputPort) {}

  async execute(chatId: string): Promise<void> {
    await this.messagingPort.sendMessage(chatId, sharedCopies.expenseGuidance()).catch(() => {
      // Silently swallow send failures so the webhook can still respond 200
      // to the messaging channel. Observability is handled at the route level.
    });
  }
}

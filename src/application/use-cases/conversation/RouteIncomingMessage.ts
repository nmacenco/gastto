// LAYER: Application
// Use case: routes a NormalizedPayload to the correct downstream handler
// based on MessageType. All business logic lives here; the Fastify route
// only deserialises the raw body and delegates to this use case.

import type { Queue } from 'bullmq';
import type { NormalizedPayload } from '../../../domain/ports/messaging';
import type { ResolveUserIdentityUseCase } from '../user/ResolveUserIdentity';
import type { MessagingPort } from '../../../domain/ports/services';
import type { ProcessMessageJobData } from '../../ports/ProcessMessageJob';
import type { HandleUnsupportedMessage } from './HandleUnsupportedMessage';

export interface RouteIncomingMessageDeps {
  messageQueue: Queue<ProcessMessageJobData>;
  resolveIdentity: ResolveUserIdentityUseCase;
  messagingPort: MessagingPort;
  handleUnsupportedMessage: HandleUnsupportedMessage;
}

export class RouteIncomingMessage {
  constructor(private readonly deps: RouteIncomingMessageDeps) {}

  async execute(payload: NormalizedPayload): Promise<void> {
    switch (payload.messageType) {
      case 'TEXT':
        await this.handleText(payload);
        return;
      case 'UNSUPPORTED':
        await this.deps.handleUnsupportedMessage.execute(payload.chatId);
        return;
      case 'MALFORMED':
        console.error({
          endpoint: '/webhook/telegram',
          code: 'MALFORMED_PAYLOAD',
          rawPayload: payload.rawPayload,
        });
        return;
      /* istanbul ignore next */
      default:
        // Exhaustiveness guard — should never happen at runtime
        return;
    }
  }

  private async handleText(payload: NormalizedPayload): Promise<void> {
    const text = payload.text;
    if (!text) {
      // Defensive: TEXT payloads should always have text, but if not,
      // treat as unsupported rather than throwing.
      await this.deps.handleUnsupportedMessage.execute(payload.chatId);
      return;
    }

    const { userId } = await this.deps.resolveIdentity.execute({
      channel: payload.channel,
      externalId: payload.chatId,
    });

    await this.deps.messageQueue.add('process-message', {
      userId,
      rawMessage: text,
      channel: payload.channel,
      externalId: payload.chatId,
      receivedAt: new Date().toISOString(),
    });

    // Acknowledgment is fire-and-forget so the HTTP response is not blocked.
    this.deps.messagingPort
      .sendMessage(payload.chatId, 'Recibido, procesando tu gasto…')
      .catch((err: Error) =>
        console.error({
          endpoint: '/webhook/telegram',
          code: 'ACK_SEND_FAILED',
          chatId: payload.chatId,
          error: err.message,
        }),
      );
  }
}

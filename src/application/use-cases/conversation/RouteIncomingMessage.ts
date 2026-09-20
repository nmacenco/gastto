// LAYER: Application
// Use case: routes a NormalizedPayload to the correct downstream handler
// based on MessageType. All business logic lives here; the Fastify route
// only deserialises the raw body and delegates to this use case.

import type { Queue } from 'bullmq';
import type { NormalizedPayload } from '../../../domain/ports/messaging';
import type { IProcessedMessageRepository } from '../../../domain/ports/ProcessedMessageRepository';
import { ProcessedMessageKey } from '../../../domain/value-objects/ProcessedMessageKey';
import type { ResolveUserIdentityUseCase } from '../user/ResolveUserIdentity';
import type { ProcessMessageJobData } from '../../ports/ProcessMessageJob';
import type { HandleUnsupportedMessage } from './HandleUnsupportedMessage';
import type { SendExpenseGuidance } from './SendExpenseGuidance';
import type { GetConversationState } from './GetConversationState';
import type { SemanticRoutingPolicy } from '../../services/semantic-router/runtime-policy';
import type { DeterministicRoutingPolicy } from '../../services/semantic-router/deterministic-routing';

export interface RouteIncomingMessageDeps {
  messageQueue: Queue<ProcessMessageJobData>;
  resolveIdentity: ResolveUserIdentityUseCase;
  processedMessageRepository: IProcessedMessageRepository;
  handleUnsupportedMessage: HandleUnsupportedMessage;
  deterministicRoutingPolicy: DeterministicRoutingPolicy;
  sendGuidance: SendExpenseGuidance;
  getConversationState: GetConversationState;
  semanticRoutingPolicy: SemanticRoutingPolicy;
}

export class RouteIncomingMessage {
  constructor(private readonly deps: RouteIncomingMessageDeps) {}

  async execute(payload: NormalizedPayload): Promise<void> {
    switch (payload.messageType) {
      case 'TEXT':
        await this.handleText(payload);
        return;
      case 'CALLBACK':
        await this.handleCallback(payload);
        return;
      case 'UNSUPPORTED':
        await this.deps.handleUnsupportedMessage.execute(payload.chatId);
        return;
      /* istanbul ignore next */
      default:
        // Exhaustiveness guard — should never happen at runtime
        // MALFORMED is handled at the route layer (ADR-011)
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

    // Idempotency guard: Telegram may retry the same webhook if the first
    // attempt timed out. The webhook already sent the ack, so skip reprocessing.
    const processedKey = new ProcessedMessageKey({
      channel: payload.channel,
      externalMessageId: payload.externalMessageId!,
    });
    if (await this.deps.processedMessageRepository.exists(processedKey)) {
      return;
    }

    const { userId } = await this.deps.resolveIdentity.execute({
      channel: payload.channel,
      externalId: payload.chatId,
    });

    const admittedForObservation = this.deps.semanticRoutingPolicy.admitsForObservation(userId);
    const conversationState = admittedForObservation
      ? null
      : await this.deps.getConversationState.execute({ userId });
    const currentState = conversationState?.currentState ?? 'IDLE';

    // When the user is in the middle of an active flow (onboarding, review,
    // clarification, etc.), every text message must reach the thick worker so
    // the FSM can interpret it in context. Only in truly idle/receiving states
    // do we classify intent and send guidance for non-financial text.
    if (
      !admittedForObservation &&
      (currentState === 'IDLE' || currentState === 'EXPENSE_RECEIVING')
    ) {
      const decision = this.deps.deterministicRoutingPolicy.decide({
        state: currentState,
        rawMessage: text,
        hasCallback: false,
      });
      if (decision.kind === 'expense_guidance') {
        await this.deps.sendGuidance.execute(payload.chatId);
        return;
      }
    }

    // TEXT payloads are only produced by the parser for valid Telegram updates,
    // so externalMessageId is always defined.
    await this.deps.messageQueue.add('process-message', {
      userId,
      rawMessage: text,
      channel: payload.channel,
      externalId: payload.chatId,
      externalMessageId: payload.externalMessageId!,
      receivedAt: payload.timestamp.toISOString(),
    });

    await this.deps.processedMessageRepository.markAsProcessed(processedKey);
  }

  private async handleCallback(payload: NormalizedPayload): Promise<void> {
    const callbackData = payload.callbackData;
    if (!callbackData) {
      // Defensive: CALLBACK payloads should always have data, but if not,
      // treat as unsupported rather than throwing.
      await this.deps.handleUnsupportedMessage.execute(payload.chatId);
      return;
    }
    if (
      payload.channel === 'telegram' &&
      (payload.userId === undefined || payload.userId !== payload.chatId)
    ) {
      return;
    }

    const processedKey = new ProcessedMessageKey({
      channel: payload.channel,
      externalMessageId: payload.externalMessageId!,
    });
    if (await this.deps.processedMessageRepository.exists(processedKey)) {
      return;
    }

    const { userId } = await this.deps.resolveIdentity.execute({
      channel: payload.channel,
      externalId: payload.chatId,
    });

    await this.deps.messageQueue.add('process-message', {
      userId,
      rawMessage: '',
      channel: payload.channel,
      externalId: payload.chatId,
      externalMessageId: payload.externalMessageId!,
      receivedAt: payload.timestamp.toISOString(),
      callbackData,
    });

    await this.deps.processedMessageRepository.markAsProcessed(processedKey);
  }
}

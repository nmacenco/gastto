// LAYER: Application
// Use case: handle the /start command.
// Returns a welcome message DTO that the route layer translates into
// the appropriate HTTP response / messaging API call.

import type { IChatMessenger } from '../../ports/IChatMessenger';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';

export interface HandleStartCommandInput {
  userId: string;
  chatId: string;
  username?: string | undefined;
}

export interface HandleStartCommandOutput {
  replyText: string;
}

export class HandleStartCommand {
  constructor(
    private readonly messenger: IChatMessenger,
    private readonly conversationRepo: IConversationStateRepository,
  ) {}

  async execute(input: HandleStartCommandInput): Promise<HandleStartCommandOutput> {
    const welcomeText = input.username
      ? `¡Hola, ${input.username}! Bienvenido a Gastto. Soy tu asistente financiero conversacional. Escribime un gasto y lo registro en tu planilla automáticamente.`
      : '¡Hola! Bienvenido a Gastto. Soy tu asistente financiero conversacional. Escribime un gasto y lo registro en tu planilla automáticamente.';

    // The use case delegates the actual delivery to the infrastructure adapter,
    // but the *content* of the message is owned by the application layer.
    await this.messenger.sendWelcome(input.chatId, input.username);

    // Ensure the user has a valid conversation state (create if missing)
    const existingState = await this.conversationRepo.findByUserId(input.userId);
    if (!existingState) {
      await this.conversationRepo.create(input.userId);
    }

    return { replyText: welcomeText };
  }
}

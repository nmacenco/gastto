// LAYER: Application
// Use case: handle the /start command.
// Returns a welcome message DTO that the route layer translates into
// the appropriate HTTP response / messaging API call.

import type { IChatMessenger } from '../../ports/IChatMessenger';

export interface HandleStartCommandInput {
  chatId: string;
  username?: string | undefined;
}

export interface HandleStartCommandOutput {
  replyText: string;
}

export class HandleStartCommand {
  constructor(private readonly messenger: IChatMessenger) {}

  async execute(input: HandleStartCommandInput): Promise<HandleStartCommandOutput> {
    const welcomeText = input.username
      ? `¡Hola, ${input.username}! Bienvenido a Gastto. Soy tu asistente financiero conversacional. Escribime un gasto y lo registro en tu planilla automáticamente.`
      : '¡Hola! Bienvenido a Gastto. Soy tu asistente financiero conversacional. Escribime un gasto y lo registro en tu planilla automáticamente.';

    // The use case delegates the actual delivery to the infrastructure adapter,
    // but the *content* of the message is owned by the application layer.
    await this.messenger.sendWelcome(input.chatId, input.username);

    return { replyText: welcomeText };
  }
}

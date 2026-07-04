// LAYER: Application
// Output port for sending messages back to the user.
// The use case calls this port; the infrastructure adapter decides
// whether the channel is Telegram, WhatsApp, or something else.

export interface IChatMessenger {
  sendWelcome(chatId: string, username?: string): Promise<void>;
}

// LAYER: Application
// Output port for sending messages to users.
// The Application layer owns this contract; Infrastructure adapters
// (Telegram, WhatsApp) provide the implementation.

export interface SendResultSuccess {
  readonly status: 'success';
}

export interface SendResultFailure {
  readonly status: 'failure';
  readonly errorCode: string;
}

export type SendResult = SendResultSuccess | SendResultFailure;

export interface MessagingOutputPort {
  sendMessage(chatId: string, text: string): Promise<SendResult>;
}

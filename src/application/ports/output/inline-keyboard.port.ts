// LAYER: Application
// Output port for sending messages with inline keyboards through channel-specific
// adapters (Telegram, WhatsApp). The core MessagingOutputPort stays stable for
// plain text; this narrow port is optional and only consumed by presenters that
// need interactive buttons.

import type { SendResult } from './messaging.port';

export interface InlineKeyboardButton {
  /** Button label shown to the user. */
  readonly text: string;
  /** Opaque payload returned by the channel when the user taps the button. */
  readonly callbackData: string;
}

export interface InlineKeyboardOutputPort {
  /**
   * Sends a message with an attached inline keyboard.
   *
   * @param chatId Destination identifier for the channel.
   * @param text Message body.
   * @param buttons Matrix of buttons (rows x columns) to render inline.
   */
  sendMessageWithInlineKeyboard(
    chatId: string,
    text: string,
    buttons: InlineKeyboardButton[][],
  ): Promise<SendResult>;
}

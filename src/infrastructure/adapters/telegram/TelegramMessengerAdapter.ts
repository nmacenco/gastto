// LAYER: Infrastructure
// Telegram Bot API adapter.
// Implements both IChatMessenger (application port) and MessagingPort (domain port)
// so it can be used by the HandleStartCommand use case and by the existing webhook flow.

import type { IChatMessenger } from '../../../application/ports/IChatMessenger';
import type { MessagingPort, SendMessageOptions } from '../../../domain/ports/services';

export class TelegramMessengerAdapter implements IChatMessenger, MessagingPort {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendWelcome(chatId: string, username?: string): Promise<void> {
    const text = username
      ? `¡Hola, ${username}! Bienvenido a Gastto. Soy tu asistente financiero conversacional. Escribime un gasto y lo registro en tu planilla automáticamente.`
      : '¡Hola! Bienvenido a Gastto. Soy tu asistente financiero conversacional. Escribime un gasto y lo registro en tu planilla automáticamente.';

    await this.sendMessage(chatId, text);
  }

  async sendMessage(externalId: string, text: string, options?: SendMessageOptions): Promise<void> {
    const parseMode =
      options?.parseMode === 'plain' || !options?.parseMode ? undefined : options.parseMode;

    const response = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: externalId,
        text,
        ...(parseMode && { parse_mode: parseMode }),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      throw new Error(`Telegram API error: ${response.status} — ${body}`);
    }

    const json = (await response.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      throw new Error(`Telegram API error: ${json.description ?? 'unknown'}`);
    }
  }
}

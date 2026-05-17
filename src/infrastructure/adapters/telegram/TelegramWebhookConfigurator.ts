// LAYER: Infrastructure
// Configurator for the Telegram Bot API webhook.
// Encapsulates setWebhook / getWebhookInfo so the rest of the app
// does not depend on Telegram HTTP details.

export interface WebhookInfo {
  url: string;
  hasCustomCertificate: boolean;
  pendingUpdateCount: number;
  ipAddress?: string | undefined;
  lastErrorDate?: number | undefined;
  lastErrorMessage?: string | undefined;
  maxConnections?: number | undefined;
  allowedUpdates?: string[] | undefined;
}

export class TelegramWebhookConfigurator {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async setWebhook(url: string, secretToken: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        secret_token: secretToken,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      throw new Error(`Telegram setWebhook failed: ${response.status} — ${body}`);
    }

    const json = (await response.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      throw new Error(`Telegram setWebhook failed: ${json.description ?? 'unknown'}`);
    }

    return true;
  }

  async getWebhookInfo(): Promise<WebhookInfo> {
    const response = await fetch(`${this.baseUrl}/getWebhookInfo`);

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      throw new Error(`Telegram getWebhookInfo failed: ${response.status} — ${body}`);
    }

    const json = (await response.json()) as {
      ok: boolean;
      result?: {
        url: string;
        has_custom_certificate: boolean;
        pending_update_count: number;
        ip_address?: string;
        last_error_date?: number;
        last_error_message?: string;
        max_connections?: number;
        allowed_updates?: string[];
      };
      description?: string;
    };

    if (!json.ok || !json.result) {
      throw new Error(`Telegram getWebhookInfo failed: ${json.description ?? 'unknown'}`);
    }

    const r = json.result;
    return {
      url: r.url,
      hasCustomCertificate: r.has_custom_certificate,
      pendingUpdateCount: r.pending_update_count,
      ipAddress: r.ip_address,
      lastErrorDate: r.last_error_date,
      lastErrorMessage: r.last_error_message,
      maxConnections: r.max_connections,
      allowedUpdates: r.allowed_updates,
    };
  }
}

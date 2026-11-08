import type {
  AccessRequestNotice,
  OperatorMailPort,
} from '../../../application/ports/OperatorMailPort';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export interface GmailOperatorMailConfig {
  sender: string;
  recipient: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class GmailOperatorMailAdapter implements OperatorMailPort {
  constructor(private readonly config: GmailOperatorMailConfig) {}

  async sendAccessRequestNotice(notice: AccessRequestNotice): Promise<void> {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new Error('Operator Gmail authorization failed');
    const tokenPayload: unknown = await tokenResponse.json();
    if (
      typeof tokenPayload !== 'object' ||
      tokenPayload === null ||
      !('access_token' in tokenPayload) ||
      typeof tokenPayload.access_token !== 'string'
    )
      throw new Error('Operator Gmail token response is invalid');

    const lines = [
      notice.kind === 'replacement'
        ? 'Solicitud de cambio de email en Gastto.'
        : 'Nueva solicitud de acceso a Gastto.',
      `Solicitud: ${notice.requestId}`,
      `Chat de Telegram: ${notice.chatId}`,
      `Email solicitado: ${notice.email}`,
      ...(notice.previousEmail
        ? [
            `El nuevo email sustituye a ${notice.previousEmail} para este chat. El anterior ya no debe aprobarse.`,
          ]
        : []),
      '',
      'Comprobá el email en Google Cloud antes de aprobar esta solicitud en Gastto.',
    ];
    const encodedBody =
      Buffer.from(lines.join('\n'), 'utf8')
        .toString('base64')
        .match(/.{1,76}/g)
        ?.join('\r\n') ?? '';
    const raw = [
      `From: ${this.config.sender}`,
      `To: ${this.config.recipient}`,
      'Subject: Gastto - solicitud de acceso pendiente',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodedBody,
    ].join('\r\n');
    const response = await fetch(SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Operator Gmail send failed (${response.status})`);
    const result: unknown = await response.json();
    if (
      typeof result !== 'object' ||
      result === null ||
      !('id' in result) ||
      typeof result.id !== 'string'
    ) {
      throw new Error('Operator Gmail did not return a message ID');
    }
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GmailOperatorMailAdapter } from './GmailOperatorMailAdapter';
import { OperatorMailError } from '../../../application/ports/OperatorMailPort';

const config = {
  sender: 'owner@gmail.com',
  recipient: 'owner@gmail.com',
  clientId: 'operator-client',
  clientSecret: 'operator-secret',
  refreshToken: 'operator-refresh',
};

afterEach(() => vi.unstubAllGlobals());

describe('GmailOperatorMailAdapter', () => {
  it('refreshes the separate operator credential and sends a replacement notice', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'short-lived-token' }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'gmail-message' }) });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new GmailOperatorMailAdapter(config);

    await adapter.sendAccessRequestNotice({
      requestId: 'request-2',
      chatId: '12345',
      email: 'new@example.com',
      kind: 'replacement',
      previousEmail: 'old@example.com',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://oauth2.googleapis.com/token');
    const refreshBody = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]
      ?.body as URLSearchParams;
    expect(refreshBody.get('refresh_token')).toBe('operator-refresh');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    );
    const sendOptions = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[1]?.[1];
    expect((sendOptions?.headers as Record<string, string>).Authorization).toBe(
      'Bearer short-lived-token',
    );
    const sendBody = JSON.parse(sendOptions?.body as string) as { raw: string };
    const mime = Buffer.from(sendBody.raw, 'base64url').toString('utf8');
    expect(mime).toContain('From: owner@gmail.com');
    expect(mime).toContain('To: owner@gmail.com');
    const encodedBody = mime.split('\r\n\r\n')[1]!.replace(/\r\n/g, '');
    expect(Buffer.from(encodedBody, 'base64').toString('utf8')).toContain(
      'El nuevo email sustituye a old@example.com para este chat.',
    );
  });

  it('does not send if the operator refresh grant fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_grant' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new GmailOperatorMailAdapter(config).sendAccessRequestNotice({
        requestId: 'request-1',
        chatId: '12345',
        email: 'user@example.com',
        kind: 'initial',
        previousEmail: null,
      }),
    ).rejects.toMatchObject({
      stage: 'token_response',
      httpStatus: 400,
      providerReason: 'invalid_grant',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('identifies a Gmail send rejection without exposing its response body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: 'token' }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({
            error: {
              errors: [{ reason: 'insufficientPermissions', message: 'private details' }],
            },
          }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new GmailOperatorMailAdapter(config).sendAccessRequestNotice({
        requestId: 'request-1',
        chatId: '12345',
        email: 'user@example.com',
        kind: 'initial',
        previousEmail: null,
      }),
    ).rejects.toEqual(new OperatorMailError('send_response', 403, 'insufficientPermissions'));
  });
});

import { describe, expect, it, vi } from 'vitest';
import { CandidateOAuthTokenService } from './CandidateOAuthTokenService';
import { AccountDeletionInProgressError } from '../ports/AccountExternalWorkFence';
import type { AccountExternalWorkFence } from '../ports/AccountExternalWorkFence';
import { OAuthDeniedError } from '../../domain/errors/OAuthDeniedError';
import type { CandidateOAuthTokenRepository } from '../ports/CandidateOAuthTokenRepository';
import type { OAuthServicePort } from '../../domain/ports/oauth';

const candidate = {
  requestId: 'request-1',
  userId: 'user-1',
  accessTokenEnc: Buffer.from('access'),
  refreshTokenEnc: Buffer.from('refresh'),
  iv: Buffer.from('access-iv'),
  refreshIv: Buffer.from('refresh-iv'),
  accessTokenExpiresAt: new Date(0),
  scope: ['drive.file'],
  grantedAt: new Date(),
  lastRefreshedAt: null,
  revokedAt: null,
};

describe('CandidateOAuthTokenService refresh fencing', () => {
  it('does not call Google when deletion starts before the refresh fence', async () => {
    const refreshAccessToken = vi.fn();
    const markRefreshed = vi.fn();
    const fence = { run: vi.fn().mockRejectedValue(new AccountDeletionInProgressError()) };
    const service = new CandidateOAuthTokenService(
      {
        findByRequestId: vi.fn().mockResolvedValue(candidate),
        markRefreshed,
      } as unknown as CandidateOAuthTokenRepository,
      { decrypt: vi.fn(), encrypt: vi.fn() },
      { refreshAccessToken } as unknown as OAuthServicePort,
      { isDeleting: vi.fn().mockResolvedValue(false) },
      fence,
    );

    await expect(
      service.getValidAccessToken({ requestId: 'request-1', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(fence.run).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(markRefreshed).not.toHaveBeenCalled();
  });

  it('marks a rejected candidate credential revoked while the fence is held', async () => {
    let insideFence = false;
    const markRevoked = vi.fn(() => {
      expect(insideFence).toBe(true);
      return Promise.resolve();
    });
    const fence: AccountExternalWorkFence = {
      run: async <T>(_userId: string, work: () => Promise<T>) => {
        insideFence = true;
        try {
          return await work();
        } finally {
          insideFence = false;
        }
      },
    };
    const refreshAccessToken = vi.fn(() => {
      expect(insideFence).toBe(true);
      return Promise.reject(new OAuthDeniedError('rejected'));
    });
    const service = new CandidateOAuthTokenService(
      {
        findByRequestId: vi.fn().mockResolvedValue(candidate),
        markRevoked,
      } as unknown as CandidateOAuthTokenRepository,
      { decrypt: vi.fn().mockReturnValue('refresh-secret'), encrypt: vi.fn() },
      { refreshAccessToken } as unknown as OAuthServicePort,
      { isDeleting: vi.fn().mockResolvedValue(false) },
      fence,
    );

    await expect(
      service.getValidAccessToken({ requestId: 'request-1', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(markRevoked).toHaveBeenCalledWith('request-1');
  });
});

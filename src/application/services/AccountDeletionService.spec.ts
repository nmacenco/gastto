import { describe, expect, it, vi } from 'vitest';
import { AccountDeletionService } from './AccountDeletionService';
import type { RevokeAccountCredentials } from '../use-cases/user/RevokeAccountCredentials';
import type { IUserProcessingLock } from '../ports/UserProcessingLock';

describe('AccountDeletionService', () => {
  it('drops temporary identifiers after a failed final Telegram delivery', async () => {
    const finish = vi.fn().mockResolvedValue(undefined);
    const service = new AccountDeletionService(
      {
        get: vi.fn().mockResolvedValue({ stage: 'notifying', remoteRevocationFailed: true }),
        identities: vi.fn().mockResolvedValue([{ channel: 'telegram', externalId: 'chat' }]),
        setStage: vi.fn(),
        eraseAccount: vi.fn(),
        finish,
      },
      { execute: vi.fn() } as unknown as RevokeAccountCredentials,
      { clean: vi.fn() },
      {
        acquire: vi.fn().mockResolvedValue('lease'),
        release: vi.fn().mockResolvedValue(undefined),
      } as unknown as IUserProcessingLock,
      { sendMessage: vi.fn().mockRejectedValue(new Error('Telegram unavailable')) },
    );
    await expect(service.resume('owner')).resolves.toBeUndefined();
    expect(finish).toHaveBeenCalledWith('owner');
  });

  it('recovers after a cleanup failure without revoking twice or restoring the account', async () => {
    let stage = 'blocked';
    const get = vi.fn(() => Promise.resolve({ stage, remoteRevocationFailed: false }));
    const setStage = vi.fn((_userId: string, next: string) => {
      stage = next;
      return Promise.resolve();
    });
    const eraseAccount = vi.fn().mockResolvedValue(undefined);
    const finish = vi.fn().mockResolvedValue(undefined);
    const clean = vi
      .fn()
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValue(undefined);
    const revoke = vi
      .fn()
      .mockResolvedValue({ remoteRevocationFailed: false, credentialsPresent: true });
    const release = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue({ status: 'success' });
    const service = new AccountDeletionService(
      {
        get,
        setStage,
        eraseAccount,
        finish,
        identities: vi.fn().mockResolvedValue([{ channel: 'telegram', externalId: 'chat' }]),
      },
      { execute: revoke } as unknown as RevokeAccountCredentials,
      { clean },
      { acquire: vi.fn().mockResolvedValue('lease'), release } as unknown as IUserProcessingLock,
      { sendMessage },
    );
    await expect(service.resume('owner')).rejects.toThrow('Redis unavailable');
    expect(eraseAccount).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    await service.resume('owner');
    expect(revoke).toHaveBeenCalledOnce();
    expect(clean).toHaveBeenCalledTimes(3);
    expect(eraseAccount).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
  });
});

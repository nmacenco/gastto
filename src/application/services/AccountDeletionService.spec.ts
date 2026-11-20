import { describe, expect, it, vi } from 'vitest';
import { AccountDeletionService } from './AccountDeletionService';
import {
  RevokeAccountCredentials,
  type EncryptedAccountCredential,
} from '../use-cases/user/RevokeAccountCredentials';
import type { IUserProcessingLock } from '../ports/UserProcessingLock';
import type { TokenEncryptionPort } from '../../domain/ports/tokenEncryption';

describe('AccountDeletionService', () => {
  it.each([
    'get',
    'revoking',
    'deleteAll',
    'cleaning',
    'clean:first',
    'eraseAccount',
    'clean:second',
    'notifying',
    'finish:before',
    'finish:after',
  ])('recovers after an interruption at %s without restoring account data', async (fault) => {
    let stage: 'blocked' | 'revoking' | 'cleaning' | 'notifying' | null = 'blocked';
    let remoteRevocationFailed = false;
    let accountExists = true;
    let credentials: EncryptedAccountCredential[] = [
      {
        provider: 'google',
        refreshTokenEnc: Buffer.from('encrypted-test-token'),
        refreshIv: Buffer.from('test-iv'),
      },
    ];
    let cleanCalls = 0;
    let interrupted = false;
    const interrupt = (at: string) => {
      if (fault !== at || interrupted) return;
      interrupted = true;
      throw new Error('SIMULATED_INTERRUPTION');
    };
    const revokeToken = vi.fn().mockResolvedValue('revoked');
    const release = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue({ status: 'success' });
    const service = new AccountDeletionService(
      {
        get: vi.fn(() => {
          interrupt('get');
          return Promise.resolve(stage ? { stage, remoteRevocationFailed } : null);
        }),
        assertWorkDrained: vi.fn().mockResolvedValue(undefined),
        identities: vi.fn().mockResolvedValue([{ channel: 'telegram', externalId: 'chat' }]),
        setStage: vi.fn(
          (_userId: string, next: 'revoking' | 'cleaning' | 'notifying', failed?: boolean) => {
            stage = next;
            if (failed !== undefined) remoteRevocationFailed = failed;
            interrupt(next);
            return Promise.resolve();
          },
        ),
        eraseAccount: vi.fn(() => {
          accountExists = false;
          interrupt('eraseAccount');
          return Promise.resolve();
        }),
        finish: vi.fn(() => {
          interrupt('finish:before');
          stage = null;
          interrupt('finish:after');
          return Promise.resolve();
        }),
      },
      new RevokeAccountCredentials(
        {
          list: vi.fn(() => Promise.resolve(credentials)),
          deleteAll: vi.fn(() => {
            credentials = [];
            interrupt('deleteAll');
            return Promise.resolve();
          }),
        },
        { decrypt: vi.fn().mockReturnValue('test-token') } as unknown as TokenEncryptionPort,
        { revokeToken },
      ),
      {
        clean: vi.fn(() => {
          cleanCalls += 1;
          interrupt(cleanCalls === 1 ? 'clean:first' : 'clean:second');
          return Promise.resolve();
        }),
      },
      { acquire: vi.fn().mockResolvedValue('lease'), release } as unknown as IUserProcessingLock,
      { sendMessage },
    );

    await expect(service.resume('owner')).rejects.toThrow('SIMULATED_INTERRUPTION');
    expect(interrupted).toBe(true);
    if (fault !== 'finish:after') expect(stage).not.toBeNull();

    await expect(service.resume('owner')).resolves.toBeUndefined();
    expect(stage).toBeNull();
    expect(accountExists).toBe(false);
    expect(credentials).toEqual([]);
    expect(revokeToken).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      'chat',
      expect.stringContaining('La eliminación no modificó tu hoja de cálculo.'),
    );
    expect(release).toHaveBeenCalledTimes(2);
    await expect(service.resume('owner')).resolves.toBeUndefined();
    expect(revokeToken).toHaveBeenCalledOnce();
  });

  it('keeps the deletion barrier and credentials until durable external work drains', async () => {
    const assertWorkDrained = vi
      .fn()
      .mockRejectedValueOnce(new Error('ACCOUNT_EXTERNAL_WORK_STILL_ACTIVE'))
      .mockResolvedValue(undefined);
    const revoke = vi
      .fn()
      .mockResolvedValue({ remoteRevocationFailed: false, credentialsPresent: false });
    const clean = vi.fn().mockResolvedValue(undefined);
    const eraseAccount = vi.fn().mockResolvedValue(undefined);
    const finish = vi.fn().mockResolvedValue(undefined);
    let stage = 'blocked';
    const service = new AccountDeletionService(
      {
        get: vi.fn(() => Promise.resolve({ stage, remoteRevocationFailed: false })),
        assertWorkDrained,
        identities: vi.fn().mockResolvedValue([]),
        setStage: vi.fn((_userId: string, next: string) => {
          stage = next;
          return Promise.resolve();
        }),
        eraseAccount,
        finish,
      },
      { execute: revoke } as unknown as RevokeAccountCredentials,
      { clean },
      {
        acquire: vi.fn().mockResolvedValue('lease'),
        release: vi.fn().mockResolvedValue(undefined),
      } as unknown as IUserProcessingLock,
      { sendMessage: vi.fn() },
    );

    await expect(service.resume('owner')).rejects.toThrow('ACCOUNT_EXTERNAL_WORK_STILL_ACTIVE');
    expect(revoke).not.toHaveBeenCalled();
    expect(clean).not.toHaveBeenCalled();
    expect(eraseAccount).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    await service.resume('owner');
    expect(revoke).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
  });

  it('drops temporary identifiers after a failed final Telegram delivery', async () => {
    const finish = vi.fn().mockResolvedValue(undefined);
    const service = new AccountDeletionService(
      {
        get: vi.fn().mockResolvedValue({ stage: 'notifying', remoteRevocationFailed: true }),
        assertWorkDrained: vi.fn().mockResolvedValue(undefined),
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
        assertWorkDrained: vi.fn().mockResolvedValue(undefined),
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

  it('retains the barrier and retries cleanup after account erasure has committed', async () => {
    let stage = 'cleaning';
    let accountExists = true;
    const get = vi.fn(() => Promise.resolve({ stage, remoteRevocationFailed: false }));
    const setStage = vi.fn((_userId: string, next: string) => {
      stage = next;
      return Promise.resolve();
    });
    const eraseAccount = vi.fn(() => {
      accountExists = false;
      return Promise.resolve();
    });
    const clean = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Redis connection lost'))
      .mockResolvedValue(undefined);
    const finish = vi.fn().mockResolvedValue(undefined);
    const revoke = vi.fn();
    const service = new AccountDeletionService(
      {
        get,
        assertWorkDrained: vi.fn().mockResolvedValue(undefined),
        setStage,
        eraseAccount,
        finish,
        identities: vi.fn().mockResolvedValue([{ channel: 'telegram', externalId: 'chat' }]),
      },
      { execute: revoke } as unknown as RevokeAccountCredentials,
      { clean },
      {
        acquire: vi.fn().mockResolvedValue('lease'),
        release: vi.fn().mockResolvedValue(undefined),
      } as unknown as IUserProcessingLock,
      { sendMessage: vi.fn().mockResolvedValue({ status: 'success' }) },
    );

    await expect(service.resume('owner')).rejects.toThrow('Redis connection lost');
    expect(accountExists).toBe(false);
    expect(stage).toBe('cleaning');
    expect(finish).not.toHaveBeenCalled();

    await expect(service.resume('owner')).resolves.toBeUndefined();
    expect(clean).toHaveBeenCalledTimes(4);
    expect(eraseAccount).toHaveBeenCalledTimes(2);
    expect(revoke).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledOnce();
  });
});

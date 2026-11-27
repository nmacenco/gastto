import { describe, it, expect, vi } from 'vitest';
import { RevokeAccountCredentials } from './RevokeAccountCredentials';
import type { TokenEncryptionPort } from '../../../domain/ports/tokenEncryption';

describe('RevokeAccountCredentials', () => {
  it('attempts all grants and always deletes local ciphertext after a remote failure', async () => {
    const list = vi.fn().mockResolvedValue([
      { provider: 'google', refreshTokenEnc: Buffer.from('one'), refreshIv: Buffer.from('iv') },
      { provider: 'google', refreshTokenEnc: Buffer.from('two'), refreshIv: Buffer.from('iv') },
    ]);
    const deleteAll = vi.fn().mockResolvedValue(undefined);
    const revokeToken = vi
      .fn()
      .mockResolvedValueOnce('not_confirmed')
      .mockResolvedValueOnce('revoked');
    const decrypt = vi.fn().mockReturnValueOnce('secret-one').mockReturnValueOnce('secret-two');
    const service = new RevokeAccountCredentials(
      { list, deleteAll },
      { decrypt } as unknown as TokenEncryptionPort,
      { revokeToken },
    );
    expect(await service.execute('owner')).toEqual({
      remoteRevocationFailed: true,
      credentialsPresent: true,
    });
    expect(revokeToken).toHaveBeenCalledTimes(2);
    expect(deleteAll).toHaveBeenCalledWith('owner');
  });

  it('deletes local ciphertext when decryption fails', async () => {
    const deleteAll = vi.fn().mockResolvedValue(undefined);
    const service = new RevokeAccountCredentials(
      {
        list: vi
          .fn()
          .mockResolvedValue([
            { provider: 'google', refreshTokenEnc: Buffer.from('x'), refreshIv: Buffer.from('i') },
          ]),
        deleteAll,
      },
      {
        decrypt: vi.fn().mockImplementation(() => {
          throw new Error('secret');
        }),
      } as unknown as TokenEncryptionPort,
      { revokeToken: vi.fn() },
    );
    expect(await service.execute('owner')).toEqual({
      remoteRevocationFailed: true,
      credentialsPresent: true,
    });
    expect(deleteAll).toHaveBeenCalledOnce();
  });
});

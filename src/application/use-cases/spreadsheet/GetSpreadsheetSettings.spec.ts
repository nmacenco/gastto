import { describe, expect, it, vi } from 'vitest';
import { GetSpreadsheetSettings } from './GetSpreadsheetSettings';
import type {
  IOAuthTokenRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import type { OAuthToken, SpreadsheetConfig } from '../../../domain/entities/SpreadsheetConfig';

describe('GetSpreadsheetSettings', () => {
  const config = {
    provider: 'google',
    fileName: 'Gastos',
    sheetName: 'Octubre',
  } as SpreadsheetConfig;
  const token = {
    provider: 'google',
    accessTokenExpiresAt: new Date('2000-01-01'),
    revokedAt: null,
  } as OAuthToken;

  function subject(savedConfig: SpreadsheetConfig | null, savedToken: OAuthToken | null) {
    const configRepository = { findByUserId: vi.fn().mockResolvedValue(savedConfig) };
    const tokenRepository = { findByUserAndProvider: vi.fn().mockResolvedValue(savedToken) };
    return {
      useCase: new GetSpreadsheetSettings(
        tokenRepository as unknown as IOAuthTokenRepository,
        configRepository as unknown as ISpreadsheetConfigRepository,
      ),
      configRepository,
      tokenRepository,
    };
  }

  it('shows a stored credential as available even when its access token expired', async () => {
    const { useCase, tokenRepository } = subject(config, token);
    await expect(useCase.execute({ userId: 'u' })).resolves.toEqual({
      credentialStatus: 'available',
      provider: 'google',
      fileName: 'Gastos',
      sheetName: 'Octubre',
    });
    expect(tokenRepository.findByUserAndProvider).toHaveBeenCalledWith('u', 'google');
  });

  it('reports revoked and missing credentials', async () => {
    await expect(
      subject(config, { ...token, revokedAt: new Date() }).useCase.execute({ userId: 'u' }),
    ).resolves.toMatchObject({ credentialStatus: 'revoked' });
    await expect(subject(config, null).useCase.execute({ userId: 'u' })).resolves.toMatchObject({
      credentialStatus: 'missing',
    });
  });

  it('reports incomplete onboarding without a destination', async () => {
    await expect(subject(null, token).useCase.execute({ userId: 'u' })).resolves.toEqual({
      credentialStatus: 'available',
      provider: 'google',
      fileName: null,
      sheetName: null,
    });
    await expect(subject(null, null).useCase.execute({ userId: 'u' })).resolves.toEqual({
      credentialStatus: 'missing',
      provider: null,
      fileName: null,
      sheetName: null,
    });
  });
});

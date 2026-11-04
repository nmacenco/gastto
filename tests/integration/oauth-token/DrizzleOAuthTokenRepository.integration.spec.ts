// LAYER: Tests / Integration
// Integration tests for DrizzleOAuthTokenRepository.
// Runs against a real PostgreSQL database inside a testcontainer.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt } from '../../../src/infrastructure/security/aes256gcm';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as schema from '../../../src/infrastructure/db/schema';
import {
  startDbContainer,
  stopDbContainer,
  getConnectionString,
  isDockerAvailable,
} from '../helpers/db-container';
import { runMigrations } from '../helpers/migrate';
import { createUser } from '../helpers/fixtures';
import { DrizzleOAuthTokenRepository } from '../../../src/infrastructure/db/repositories/DrizzleOAuthTokenRepository';

describe.skipIf(!isDockerAvailable())('Integration :: DrizzleOAuthTokenRepository', () => {
  let container: StartedPostgreSqlContainer;
  let pgClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repo: DrizzleOAuthTokenRepository;

  beforeAll(async () => {
    container = await startDbContainer();
    pgClient = postgres(getConnectionString(container), { max: 1 });
    await runMigrations(pgClient);
    db = drizzle(pgClient, { schema });
    repo = new DrizzleOAuthTokenRepository(db);
  }, 60000);

  afterAll(async () => {
    if (pgClient) await pgClient.end();
    if (container) await stopDbContainer(container);
  });

  describe('upsert and findByUserAndProvider', () => {
    it('inserts a new token and returns the mapped entity', async () => {
      const user = await createUser(db);

      const result = await repo.upsert({
        userId: user.userId,
        provider: 'google',
        accessTokenEnc: Buffer.from('enc-access-1'),
        refreshTokenEnc: Buffer.from('enc-refresh-1'),
        iv: Buffer.from('iv-16-bytes-long'),
        refreshIv: Buffer.from('refresh-iv-16-bytes'),
        accessTokenExpiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: ['https://www.googleapis.com/auth/drive.file'],
        grantedAt: new Date('2026-01-01T00:00:00Z'),
        lastRefreshedAt: null,
        revokedAt: null,
      });

      expect(result.userId).toBe(user.userId);
      expect(result.provider).toBe('google');
      expect(result.accessTokenEnc).toEqual(Buffer.from('enc-access-1'));
      expect(result.refreshTokenEnc).toEqual(Buffer.from('enc-refresh-1'));
      expect(result.iv).toEqual(Buffer.from('iv-16-bytes-long'));
      expect(result.scope).toEqual(['https://www.googleapis.com/auth/drive.file']);
      expect(result.lastRefreshedAt).toBeNull();
      expect(result.revokedAt).toBeNull();

      const found = await repo.findByUserAndProvider(user.userId, 'google');
      expect(found).not.toBeNull();
      expect(found!.userId).toBe(user.userId);
      expect(found!.provider).toBe('google');
      expect(found!.accessTokenEnc).toEqual(Buffer.from('enc-access-1'));
    });

    it('updates an existing token on conflict for the same (userId, provider)', async () => {
      const user = await createUser(db);

      await repo.upsert({
        userId: user.userId,
        provider: 'google',
        accessTokenEnc: Buffer.from('old-access'),
        refreshTokenEnc: Buffer.from('old-refresh'),
        iv: Buffer.from('old-iv'),
        refreshIv: Buffer.from('old-refresh-iv'),
        accessTokenExpiresAt: new Date('2026-06-01T00:00:00Z'),
        scope: ['old.scope'],
        grantedAt: new Date('2026-01-01T00:00:00Z'),
        lastRefreshedAt: null,
        revokedAt: null,
      });

      const result = await repo.upsert({
        userId: user.userId,
        provider: 'google',
        accessTokenEnc: Buffer.from('new-access'),
        refreshTokenEnc: Buffer.from('new-refresh'),
        iv: Buffer.from('new-iv'),
        refreshIv: Buffer.from('new-refresh-iv'),
        accessTokenExpiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: ['https://www.googleapis.com/auth/drive.file'],
        grantedAt: new Date('2026-06-01T00:00:00Z'),
        lastRefreshedAt: new Date('2026-06-01T00:00:00Z'),
        revokedAt: null,
      });

      expect(result.accessTokenEnc).toEqual(Buffer.from('new-access'));
      expect(result.refreshTokenEnc).toEqual(Buffer.from('new-refresh'));
      expect(result.iv).toEqual(Buffer.from('new-iv'));
      expect(result.accessTokenExpiresAt).toEqual(new Date('2026-12-31T23:59:59Z'));
      expect(result.lastRefreshedAt).toEqual(new Date('2026-06-01T00:00:00Z'));

      const found = await repo.findByUserAndProvider(user.userId, 'google');
      expect(found).not.toBeNull();
      expect(found!.accessTokenEnc).toEqual(Buffer.from('new-access'));
      expect(found!.refreshTokenEnc).toEqual(Buffer.from('new-refresh'));
    });

    it('returns null when no row exists', async () => {
      const user = await createUser(db);
      const found = await repo.findByUserAndProvider(user.userId, 'google');
      expect(found).toBeNull();
    });
  });

  describe('markRefreshed', () => {
    it('updates accessTokenEnc, iv, accessTokenExpiresAt, and lastRefreshedAt', async () => {
      const user = await createUser(db);

      const inserted = await repo.upsert({
        userId: user.userId,
        provider: 'google',
        accessTokenEnc: Buffer.from('enc-access'),
        refreshTokenEnc: Buffer.from('enc-refresh'),
        iv: Buffer.from('iv'),
        refreshIv: Buffer.from('refresh-iv'),
        accessTokenExpiresAt: new Date('2026-06-01T00:00:00Z'),
        scope: ['scope'],
        grantedAt: new Date('2026-01-01T00:00:00Z'),
        lastRefreshedAt: null,
        revokedAt: null,
      });

      const beforeRefresh = await repo.findByUserAndProvider(user.userId, 'google');
      expect(beforeRefresh!.lastRefreshedAt).toBeNull();

      await repo.markRefreshed(
        inserted.id,
        Buffer.from('new-access'),
        Buffer.from('new-iv'),
        new Date('2026-12-31T23:59:59Z'),
      );

      const afterRefresh = await repo.findByUserAndProvider(user.userId, 'google');
      expect(afterRefresh).not.toBeNull();
      expect(afterRefresh!.accessTokenEnc).toEqual(Buffer.from('new-access'));
      expect(afterRefresh!.iv).toEqual(Buffer.from('new-iv'));
      expect(afterRefresh!.accessTokenExpiresAt).toEqual(new Date('2026-12-31T23:59:59Z'));
      expect(afterRefresh!.lastRefreshedAt).not.toBeNull();
    });
  });

  describe('markRevoked', () => {
    it('sets revokedAt', async () => {
      const user = await createUser(db);

      const inserted = await repo.upsert({
        userId: user.userId,
        provider: 'google',
        accessTokenEnc: Buffer.from('enc-access'),
        refreshTokenEnc: Buffer.from('enc-refresh'),
        iv: Buffer.from('iv'),
        refreshIv: Buffer.from('refresh-iv'),
        accessTokenExpiresAt: new Date('2026-06-01T00:00:00Z'),
        scope: ['scope'],
        grantedAt: new Date('2026-01-01T00:00:00Z'),
        lastRefreshedAt: null,
        revokedAt: null,
      });

      const beforeRevoke = await repo.findByUserAndProvider(user.userId, 'google');
      expect(beforeRevoke!.revokedAt).toBeNull();

      await repo.markRevoked(inserted.id);

      const afterRevoke = await repo.findByUserAndProvider(user.userId, 'google');
      expect(afterRevoke).not.toBeNull();
      expect(afterRevoke!.revokedAt).not.toBeNull();
    });
  });

  describe('OAuth Token Encryption round-trip', () => {
    it('never exposes plaintext tokens in raw DB query results', async () => {
      const user = await createUser(db);
      const otherUser = await createUser(db);
      const key = Buffer.from('a'.repeat(64), 'hex');
      const accessPlaintext = 'CANARY-ACCESS-DO-NOT-PERSIST';
      const refreshPlaintext = 'CANARY-REFRESH-DO-NOT-PERSIST';
      const access = encrypt(accessPlaintext, key);
      const refresh = encrypt(refreshPlaintext, key);

      await repo.upsert({
        userId: user.userId,
        provider: 'google',
        accessTokenEnc: access.ciphertext,
        refreshTokenEnc: refresh.ciphertext,
        iv: access.iv,
        refreshIv: refresh.iv,
        accessTokenExpiresAt: new Date('2026-12-31T23:59:59Z'),
        scope: ['https://www.googleapis.com/auth/drive.file'],
        grantedAt: new Date('2026-01-01T00:00:00Z'),
        lastRefreshedAt: null,
        revokedAt: null,
      });

      // Query the raw DB directly (bypass the repository mapper)
      const [rawRow] = await pgClient`
        SELECT access_token_enc, refresh_token_enc, iv, refresh_iv
        FROM oauth_tokens
        WHERE user_id = ${user.userId} AND provider = 'google'
      `;

      expect(rawRow).toBeDefined();
      expect(rawRow.access_token_enc).toBeInstanceOf(Buffer);
      expect(rawRow.refresh_token_enc).toBeInstanceOf(Buffer);
      expect(rawRow.iv).toBeInstanceOf(Buffer);
      expect(rawRow.refresh_iv).toBeInstanceOf(Buffer);

      const accessBytes = Buffer.from(rawRow.access_token_enc);
      const refreshBytes = Buffer.from(rawRow.refresh_token_enc);
      expect(accessBytes).toEqual(access.ciphertext);
      expect(refreshBytes).toEqual(refresh.ciphertext);
      expect(accessBytes.toString()).not.toContain(accessPlaintext);
      expect(refreshBytes.toString()).not.toContain(refreshPlaintext);
      expect(decrypt(accessBytes, Buffer.from(rawRow.iv), key)).toBe(accessPlaintext);
      expect(decrypt(refreshBytes, Buffer.from(rawRow.refresh_iv), key)).toBe(refreshPlaintext);
      await expect(repo.findByUserAndProvider(otherUser.userId, 'google')).resolves.toBeNull();
    });
  });
});

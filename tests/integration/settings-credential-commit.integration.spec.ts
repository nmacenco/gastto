import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as schema from '../../src/infrastructure/db/schema';
import { DrizzleSettingsCredentialCommit } from '../../src/infrastructure/db/repositories/DrizzleSettingsCredentialCommit';
import { DrizzleOAuthTokenRepository } from '../../src/infrastructure/db/repositories/DrizzleOAuthTokenRepository';
import type { SettingsCredentialCommitInput } from '../../src/application/ports/SettingsCredentialCommit';
import { createConversationState, createUser } from './helpers/fixtures';
import {
  getConnectionString,
  isDockerAvailable,
  startDbContainer,
  stopDbContainer,
} from './helpers/db-container';
import { runMigrations } from './helpers/migrate';

describe.skipIf(!isDockerAvailable())('Integration :: settings credential commit', () => {
  let container: StartedPostgreSqlContainer;
  let client: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let commit: DrizzleSettingsCredentialCommit;
  let tokens: DrizzleOAuthTokenRepository;

  beforeAll(async () => {
    container = await startDbContainer();
    client = postgres(getConnectionString(container), { max: 3 });
    await runMigrations(client);
    db = drizzle(client, { schema });
    commit = new DrizzleSettingsCredentialCommit(db);
    tokens = new DrizzleOAuthTokenRepository(db);
  }, 120_000);

  afterAll(async () => {
    if (client) await client.end();
    if (container) await stopDbContainer(container);
  });

  async function fixture(): Promise<SettingsCredentialCommitInput> {
    const user = await createUser(db);
    const [config] = await db
      .insert(schema.spreadsheetConfigs)
      .values({
        userId: user.userId,
        provider: 'google',
        fileId: 'file-1',
        fileName: 'Gastos',
        sheetName: 'Octubre',
        accessVerifiedAt: new Date(),
      })
      .returning();
    if (!config) throw new Error('Config fixture failed');
    await createConversationState(db, {
      userId: user.userId,
      currentState: 'SETTINGS_OAUTH',
      statePayload: {
        origin: 'settings',
        flowId: 'flow-1',
        provider: 'google',
        sourceConfigId: config.id,
        fileId: 'file-1',
        sheetName: 'Octubre',
        state: 'nonce-1',
        reminderJobId: 'job-1',
      },
      expiresAt: new Date(Date.now() + 60_000),
    });
    await tokens.upsert({
      userId: user.userId,
      provider: 'google',
      accessTokenEnc: Buffer.from('old-access'),
      refreshTokenEnc: Buffer.from('old-refresh'),
      iv: Buffer.from('old-iv'),
      refreshIv: Buffer.from('old-refresh-iv'),
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      scope: ['old-scope'],
      grantedAt: new Date(),
      lastRefreshedAt: null,
      revokedAt: null,
    });
    return {
      userId: user.userId,
      expected: { revision: '0', currentState: 'SETTINGS_OAUTH', expiry: 'unexpired' },
      flowId: 'flow-1',
      nonce: 'nonce-1',
      sourceConfigId: config.id,
      fileId: 'file-1',
      sheetName: 'Octubre',
      credential: {
        userId: user.userId,
        provider: 'google',
        accessTokenEnc: Buffer.from('new-access'),
        refreshTokenEnc: Buffer.from('new-refresh'),
        iv: Buffer.from('new-iv'),
        refreshIv: Buffer.from('new-refresh-iv'),
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        scope: ['https://www.googleapis.com/auth/spreadsheets'],
        grantedAt: new Date(),
        lastRefreshedAt: null,
        revokedAt: null,
      },
    };
  }

  it('commits token replacement and IDLE together', async () => {
    const input = await fixture();
    await expect(commit.execute(input)).resolves.toBe('committed');
    expect((await tokens.findByUserAndProvider(input.userId, 'google'))?.accessTokenEnc).toEqual(
      Buffer.from('new-access'),
    );
    const [state] = await client<{ current_state: string; state_payload: unknown }[]>`
      select current_state, state_payload from conversation_states where user_id = ${input.userId}
    `;
    expect(state).toMatchObject({ current_state: 'IDLE', state_payload: null });
  });

  it('rejects stale revisions and changed destinations without touching the token', async () => {
    const input = await fixture();
    await expect(
      commit.execute({ ...input, expected: { ...input.expected, revision: '8' } }),
    ).resolves.toBe('stale');
    await expect(commit.execute({ ...input, sheetName: 'Other' })).resolves.toBe('stale');
    expect((await tokens.findByUserAndProvider(input.userId, 'google'))?.accessTokenEnc).toEqual(
      Buffer.from('old-access'),
    );
  });

  it('rolls back the replacement when the final state transition fails', async () => {
    const input = await fixture();
    await client.unsafe(`
      create function reject_settings_exit() returns trigger language plpgsql as $$
      begin
        if old.user_id = '${input.userId}' and new.current_state = 'IDLE' then
          raise exception 'forced settings exit failure';
        end if;
        return new;
      end $$
    `);
    await client.unsafe(
      'create trigger reject_settings_exit before update on conversation_states for each row execute function reject_settings_exit()',
    );
    try {
      await expect(commit.execute(input)).rejects.toThrow('forced settings exit failure');
      expect((await tokens.findByUserAndProvider(input.userId, 'google'))?.accessTokenEnc).toEqual(
        Buffer.from('old-access'),
      );
      const [state] = await client<{ current_state: string }[]>`
        select current_state from conversation_states where user_id = ${input.userId}
      `;
      expect(state?.current_state).toBe('SETTINGS_OAUTH');
    } finally {
      await client.unsafe('drop trigger reject_settings_exit on conversation_states');
      await client.unsafe('drop function reject_settings_exit()');
    }
  });

  it('keeps the state and old credential when token persistence fails', async () => {
    const input = await fixture();
    await client.unsafe(`
      create function reject_settings_token() returns trigger language plpgsql as $$
      begin
        if old.user_id = '${input.userId}' then
          raise exception 'forced token failure';
        end if;
        return new;
      end $$
    `);
    await client.unsafe(
      'create trigger reject_settings_token before update on oauth_tokens for each row execute function reject_settings_token()',
    );
    try {
      await expect(commit.execute(input)).rejects.toThrow('forced token failure');
      expect((await tokens.findByUserAndProvider(input.userId, 'google'))?.accessTokenEnc).toEqual(
        Buffer.from('old-access'),
      );
      const [state] = await client<{ current_state: string }[]>`
        select current_state from conversation_states where user_id = ${input.userId}
      `;
      expect(state?.current_state).toBe('SETTINGS_OAUTH');
    } finally {
      await client.unsafe('drop trigger reject_settings_token on oauth_tokens');
      await client.unsafe('drop function reject_settings_token()');
    }
  });
});

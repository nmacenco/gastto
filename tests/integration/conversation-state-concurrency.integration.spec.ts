import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import Redis from 'ioredis';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as schema from '../../src/infrastructure/db/schema';
import {
  getConnectionString,
  isDockerAvailable,
  startDbContainer,
  stopDbContainer,
} from './helpers/db-container';
import { runMigrations } from './helpers/migrate';
import { createConversationState, createUser } from './helpers/fixtures';
import { DrizzleConversationStateRepository } from '../../src/infrastructure/db/repositories/DrizzleConversationStateRepository';
import { DrizzleExpenseQueueRepository } from '../../src/infrastructure/db/repositories/DrizzleExpenseQueueRepository';
import { RedisUserProcessingLock } from '../../src/infrastructure/redis/RedisUserProcessingLock';
import type { FsmState } from '../../src/domain/entities/ConversationState';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe.skipIf(!isDockerAvailable())('Integration :: conversation state concurrency', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  let sql: postgres.Sql;
  let redis: Redis;
  let repo: DrizzleConversationStateRepository;

  beforeAll(async () => {
    [postgresContainer, redisContainer] = await Promise.all([
      startDbContainer(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);
    sql = postgres(getConnectionString(postgresContainer), { max: 4 });
    await runMigrations(sql);
    repo = new DrizzleConversationStateRepository(drizzle(sql, { schema }));
    redis = new Redis(redisContainer.getMappedPort(6379), redisContainer.getHost(), {
      maxRetriesPerRequest: 1,
    });
  }, 120_000);

  afterAll(async () => {
    if (redis) redis.disconnect();
    if (sql) await sql.end();
    await Promise.all([
      postgresContainer ? stopDbContainer(postgresContainer) : Promise.resolve(),
      redisContainer ? redisContainer.stop() : Promise.resolve(),
    ]);
  });

  async function state(currentState: FsmState = 'EXPENSE_REVIEW') {
    const db = drizzle(sql, { schema });
    const user = await createUser(db);
    await createConversationState(db, {
      userId: user.userId,
      currentState,
      statePayload: { nonce: 'old' },
      expiresAt: new Date(Date.now() + 60_000),
    });
    return (await repo.findByUserId(user.userId))!;
  }

  it('applies the additive migration on fresh and legacy NULL/JSONB rows', async () => {
    const freshUser = await createUser(drizzle(sql, { schema }));
    await createConversationState(drizzle(sql, { schema }), { userId: freshUser.userId });
    const [fresh] = await sql<{ revision: string }[]>`
      select revision::text as revision
      from conversation_states
      where user_id = ${freshUser.userId}
    `;
    expect(fresh?.revision).toBe('0');

    await sql.unsafe('create schema migration_upgrade');
    await sql.unsafe(`
      create table migration_upgrade.conversation_states (
        user_id uuid primary key,
        state_payload jsonb,
        expires_at timestamp
      )
    `);
    await sql.unsafe(`
      insert into migration_upgrade.conversation_states (user_id, state_payload, expires_at)
      values
        ('00000000-0000-0000-0000-000000000001', null, null),
        ('00000000-0000-0000-0000-000000000002', '{"legacy":true}'::jsonb, null)
    `);
    const migration = await readFile(
      join(process.cwd(), 'src/infrastructure/db/migrations/0009_wooden_polaris.sql'),
      'utf8',
    );
    await sql.begin(async (tx) => {
      await tx.unsafe('set local search_path to migration_upgrade');
      await tx.unsafe(migration);
    });
    const rows = await sql<{ revision: string; state_payload: unknown }[]>`
      select revision::text as revision, state_payload
      from migration_upgrade.conversation_states
      order by user_id
    `;
    expect(rows).toEqual([
      { revision: '0', state_payload: null },
      { revision: '0', state_payload: { legacy: true } },
    ]);
  });

  it('rejects same-state ABA and competing corrections by revision', async () => {
    const observed = await state();
    const expected = {
      revision: observed.revision,
      currentState: observed.currentState,
      expiry: 'unexpired' as const,
    };
    const writes = await Promise.all([
      repo.transition({
        userId: observed.userId,
        expected,
        nextState: 'EXPENSE_REVIEW',
        payload: { version: 'A' },
        expiresAt: observed.expiresAt,
      }),
      repo.transition({
        userId: observed.userId,
        expected,
        nextState: 'EXPENSE_CORRECTING',
        payload: { version: 'B' },
        expiresAt: observed.expiresAt,
      }),
    ]);
    expect(writes.filter((result) => result.status === 'updated')).toHaveLength(1);
    const stale = await repo.transition({
      userId: observed.userId,
      expected,
      nextState: 'IDLE',
      payload: null,
      expiresAt: null,
    });
    expect(stale.status).toBe('stale');
  });

  it('rejects stale timeout, OAuth nonce, and corruption-reset snapshots', async () => {
    const observed = await state('ONBOARDING_DRIVE');
    const expected = {
      revision: observed.revision,
      currentState: observed.currentState,
      expiry: 'any' as const,
    };
    const rotated = await repo.transition({
      userId: observed.userId,
      expected,
      nextState: 'ONBOARDING_DRIVE',
      payload: { state: 'new-nonce' },
      expiresAt: null,
    });
    expect(rotated.status).toBe('updated');
    await expect(
      repo.transition({
        userId: observed.userId,
        expected: { ...expected, expiry: 'expired' },
        nextState: 'IDLE',
        payload: null,
        expiresAt: null,
      }),
    ).resolves.toMatchObject({ status: 'stale' });
    await expect(
      repo.transition({
        userId: observed.userId,
        expected,
        nextState: 'ONBOARDING_FILE',
        payload: null,
        expiresAt: null,
      }),
    ).resolves.toMatchObject({ status: 'stale' });
    await expect(
      repo.transition({
        userId: observed.userId,
        expected: { ...expected, currentState: 'CORRUPT' },
        nextState: 'IDLE',
        payload: null,
        expiresAt: null,
      }),
    ).resolves.toMatchObject({ status: 'stale' });
  });

  it('creates one initial state under concurrent insertion', async () => {
    const user = await createUser(drizzle(sql, { schema }));
    const created = await Promise.all([repo.create(user.userId), repo.create(user.userId)]);
    expect(created[0].revision).toBe('0');
    expect(created[1].userId).toBe(created[0].userId);
  });

  it('keeps renewal and release token-safe after ownership replacement', async () => {
    const lock = new RedisUserProcessingLock(redis);
    const oldToken = (await lock.acquire('lease-user', 1_000))!;
    await redis.del('process-message:lock:lease-user');
    const newToken = (await lock.acquire('lease-user', 1_000))!;
    expect(await lock.renew('lease-user', oldToken, 1_000)).toBe(false);
    await lock.release('lease-user', oldToken);
    expect(await lock.renew('lease-user', newToken, 1_000)).toBe(true);
  });

  it('keeps a different queue successor when a delayed handoff targets the old item', async () => {
    const db = drizzle(sql, { schema });
    const user = await createUser(db);
    const queue = new DrizzleExpenseQueueRepository(db);
    const first = await queue.enqueue(user.userId, 'Taxi 12 EUR', 'telegram');
    await expect(queue.dequeueFirst(user.userId, first.id)).resolves.toMatchObject({ id: first.id });
    const successor = await queue.enqueue(user.userId, 'Lunch 15 EUR', 'telegram');

    await expect(queue.dequeueFirst(user.userId, first.id)).resolves.toBeNull();
    await expect(queue.findByUserId(user.userId)).resolves.toEqual([
      expect.objectContaining({ id: successor.id, rawMessage: 'Lunch 15 EUR' }),
    ]);
  });

  it('blocks a deferred stale worker before queue, append, delete, or message effects', async () => {
    const observed = await state();
    const append = vi.fn();
    const deleteRow = vi.fn();
    const dequeue = vi.fn();
    const send = vi.fn();
    let releaseBoundary!: () => void;
    const boundary = new Promise<void>((resolve) => {
      releaseBoundary = resolve;
    });
    const delayed = (async () => {
      await boundary;
      const transition = await repo.transition({
        userId: observed.userId,
        expected: {
          revision: observed.revision,
          currentState: observed.currentState,
          expiry: 'unexpired',
        },
        nextState: 'IDLE',
        payload: null,
        expiresAt: null,
      });
      if (transition.status !== 'updated') return transition.status;
      await dequeue();
      await append();
      await deleteRow();
      await send();
      return transition.status;
    })();

    await expect(
      repo.transition({
        userId: observed.userId,
        expected: {
          revision: observed.revision,
          currentState: observed.currentState,
          expiry: 'unexpired',
        },
        nextState: 'EXPENSE_CORRECTING',
        payload: { version: 'newer' },
        expiresAt: observed.expiresAt,
      }),
    ).resolves.toMatchObject({ status: 'updated' });
    releaseBoundary();

    await expect(delayed).resolves.toBe('stale');
    expect(dequeue).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('allows one financial claim, blocks replay, and finalizes by the same claim after lease loss', async () => {
    const observed = await state();
    const expected = {
      revision: observed.revision,
      currentState: observed.currentState,
      expiry: 'unexpired' as const,
    };
    const claim = (claimId: string) => ({
      claimId,
      kind: 'save',
      operationId: `${observed.userId}:save`,
      sourceMessageId: null,
      status: 'in_flight',
      target: { expense: 'immutable' },
    });
    const [first, duplicate] = await Promise.all([
      repo.transition({
        userId: observed.userId,
        expected,
        nextState: 'EXPENSE_SAVING',
        payload: { executionClaim: claim('claim-1') },
        expiresAt: null,
        claimId: 'claim-1',
      }),
      repo.transition({
        userId: observed.userId,
        expected,
        nextState: 'EXPENSE_SAVING',
        payload: { executionClaim: claim('claim-2') },
        expiresAt: null,
        claimId: 'claim-2',
      }),
    ]);
    expect([first.status, duplicate.status].filter((status) => status === 'updated')).toHaveLength(
      1,
    );
    const claimed = (await repo.findByUserId(observed.userId))!;
    const activeClaimId = (claimed.statePayload!.executionClaim as { claimId: string }).claimId;
    const competing = await repo.transition({
      userId: observed.userId,
      expected: { revision: claimed.revision, currentState: claimed.currentState, expiry: 'any' },
      nextState: 'IDLE',
      payload: null,
      expiresAt: null,
    });
    expect(competing.status).toBe('operation_in_progress');
    const finalized = await repo.transition({
      userId: observed.userId,
      expected: { revision: claimed.revision, currentState: claimed.currentState, expiry: 'any' },
      nextState: 'IDLE',
      payload: null,
      expiresAt: null,
      claimId: activeClaimId,
    });
    expect(finalized.status).toBe('updated');
  });
});

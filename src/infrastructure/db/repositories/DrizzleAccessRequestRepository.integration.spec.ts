import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import * as schema from '../schema';
import { RequestAccess } from '../../../application/use-cases/user/RequestAccess';
import { DrizzleAccessRequestRepository } from './DrizzleAccessRequestRepository';

const describePostgres = process.env.RUN_POSTGRES_INTEGRATION === 'true' ? describe : describe.skip;
const userId = '11111111-1111-4111-8111-111111111111';
const externalId = '123456789';
let container: StartedPostgreSqlContainer;
let client: postgres.Sql;
let db: PostgresJsDatabase<typeof schema>;
let repository: DrizzleAccessRequestRepository;
let requestAccess: RequestAccess;
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();
const logger = { info: mockLoggerInfo, error: mockLoggerError } as unknown as Logger;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  client = postgres(container.getConnectionUri(), { max: 5 });
  await client`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../migrations') });
  repository = new DrizzleAccessRequestRepository(db, logger);
  requestAccess = new RequestAccess(repository);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.users);
  await db.insert(schema.users).values({ userId, status: 'onboarding' });
  await db.insert(schema.messagingIdentities).values({ userId, channel: 'telegram', externalId });
});

afterAll(async () => {
  if (client) await client.end();
  if (container) await container.stop();
});

describePostgres('Telegram access request persistence (PostgreSQL)', () => {
  it('commits the normalized email under the request ID linked to the Telegram identity', async () => {
    const result = await requestAccess.execute({
      userId,
      rawEmail: '  User@Example.com  ',
      kind: 'initial',
    });
    expect(result.status).toBe('submitted');
    if (result.status !== 'submitted') return;
    expect(result.result.created).toBe(true);

    const [row] = await db
      .select({
        id: schema.accessRequests.id,
        userId: schema.accessRequests.userId,
        email: schema.accessRequests.email,
        kind: schema.accessRequests.kind,
        status: schema.accessRequests.status,
        externalId: schema.messagingIdentities.externalId,
      })
      .from(schema.accessRequests)
      .innerJoin(
        schema.messagingIdentities,
        eq(schema.accessRequests.userId, schema.messagingIdentities.userId),
      )
      .where(eq(schema.accessRequests.id, result.result.request.id));
    expect(row).toEqual({
      id: result.result.request.id,
      userId,
      email: 'user@example.com',
      kind: 'initial',
      status: 'pending',
      externalId,
    });
    expect(await repository.findPending(userId)).toMatchObject({ id: row?.id });
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ACCESS_REQUEST_DB_SUBMIT_STARTED', userId }),
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ACCESS_REQUEST_DB_SUBMIT_COMMITTED',
        userId,
        requestId: row?.id,
        created: true,
      }),
    );
  });

  it('reuses an identical pending request and supersedes it for a different email', async () => {
    const first = await requestAccess.execute({
      userId,
      rawEmail: 'first@example.com',
      kind: 'initial',
    });
    const repeated = await requestAccess.execute({
      userId,
      rawEmail: ' FIRST@example.com ',
      kind: 'initial',
    });
    const changed = await requestAccess.execute({
      userId,
      rawEmail: 'second@example.com',
      kind: 'initial',
    });
    expect(first.status).toBe('submitted');
    expect(repeated.status).toBe('submitted');
    expect(changed.status).toBe('submitted');
    if (
      first.status !== 'submitted' ||
      repeated.status !== 'submitted' ||
      changed.status !== 'submitted'
    )
      return;
    expect(repeated.result).toMatchObject({
      created: false,
      request: { id: first.result.request.id },
    });
    expect(changed.result).toMatchObject({ created: true, previousEmail: 'first@example.com' });
    const rows = await db
      .select()
      .from(schema.accessRequests)
      .where(eq(schema.accessRequests.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.result.request.id, status: 'superseded' }),
        expect.objectContaining({ id: changed.result.request.id, status: 'pending' }),
      ]),
    );
  });

  it('does not create an access request when its owner does not exist', async () => {
    await expect(
      requestAccess.execute({
        userId: '22222222-2222-4222-8222-222222222222',
        rawEmail: 'missing@example.com',
        kind: 'initial',
      }),
    ).rejects.toThrow('Access request owner does not exist');
    expect(await db.select().from(schema.accessRequests)).toHaveLength(0);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ACCESS_REQUEST_DB_SUBMIT_FAILED' }),
    );
  });

  it('logs the notification timestamp update and rejects a zero-row update', async () => {
    const submitted = await requestAccess.execute({
      userId,
      rawEmail: 'user@example.com',
      kind: 'initial',
    });
    expect(submitted.status).toBe('submitted');
    if (submitted.status !== 'submitted') return;
    const requestId = submitted.result.request.id;

    await repository.markNotificationSent(requestId);
    const persisted = await repository.findById(requestId);
    expect(persisted?.notificationSentAt).toBeInstanceOf(Date);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ACCESS_REQUEST_DB_NOTICE_UPDATE_COMMITTED',
        requestId,
        affectedRows: 1,
      }),
    );

    await db.delete(schema.accessRequests).where(eq(schema.accessRequests.id, requestId));
    await expect(repository.markNotificationSent(requestId)).rejects.toThrow(
      'Access request notification update matched no row',
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ACCESS_REQUEST_DB_NOTICE_UPDATE_FAILED',
        requestId,
        affectedRows: 0,
      }),
    );
  });
});

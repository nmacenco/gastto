// LAYER: Tests / Integration
// Integration tests for the 5 Gherkin conversation-state scenarios.
// Runs against a real PostgreSQL database inside a testcontainer.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as schema from '../../../src/infrastructure/db/schema';
import {
  startDbContainer,
  stopDbContainer,
  getConnectionString,
  isDockerAvailable,
} from '../helpers/db-container';
import { runMigrations } from '../helpers/migrate';
import { createUser, createConversationState, createMessagingIdentity } from '../helpers/fixtures';
import { DrizzleConversationStateRepository } from '../../../src/infrastructure/db/repositories/DrizzleConversationStateRepository';
import { DrizzleOperationLogRepository } from '../../../src/infrastructure/db/repositories/DrizzleOperationLogRepository';
import { DrizzleUserRepository } from '../../../src/infrastructure/db/repositories/DrizzleUserRepository';
import { HandleStartCommand } from '../../../src/application/use-cases/conversation/HandleStartCommand';
import { TransitionConversationState } from '../../../src/application/use-cases/conversation/TransitionConversationState';
import { GetConversationState } from '../../../src/application/use-cases/conversation/GetConversationState';
import { RecoverCorruptedState } from '../../../src/application/use-cases/conversation/RecoverCorruptedState';
import { HandleExpiredSessions } from '../../../src/application/use-cases/conversation/HandleExpiredSessions';
import type { IChatMessenger } from '../../../src/application/ports/IChatMessenger';
import type { MessagingOutputPort } from '../../../src/application/ports/output/messaging.port';
import type { Redis } from 'ioredis';

describe.skipIf(!isDockerAvailable())('Integration :: ConversationState FSM', () => {
  let container: StartedPostgreSqlContainer;
  let pgClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let conversationRepo: DrizzleConversationStateRepository;
  let operationLogRepo: DrizzleOperationLogRepository;
  let userRepo: DrizzleUserRepository;

  beforeAll(async () => {
    container = await startDbContainer();
    pgClient = postgres(getConnectionString(container), { max: 1 });
    await runMigrations(pgClient);
    db = drizzle(pgClient, { schema });

    conversationRepo = new DrizzleConversationStateRepository(db);
    operationLogRepo = new DrizzleOperationLogRepository(db);

    const fakeRedis = {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue('OK'),
    } as unknown as Redis;

    userRepo = new DrizzleUserRepository(db, fakeRedis);
  }, 60000);

  afterAll(async () => {
    if (pgClient) await pgClient.end();
    if (container) await stopDbContainer(container);
  });

  it('Scenario 1: New user initialization via /start creates IDLE state', async () => {
    const user = await createUser(db);
    const messengerMock: IChatMessenger = {
      sendWelcome: vi.fn().mockResolvedValue(undefined),
    };

    const useCase = new HandleStartCommand(messengerMock, conversationRepo);
    const result = await useCase.execute({
      userId: user.userId,
      chatId: '12345',
      username: 'testuser',
    });

    expect(result.replyText).toContain('Bienvenido a Gastto');
    expect(messengerMock.sendWelcome).toHaveBeenCalledWith('12345', 'testuser');

    const state = await conversationRepo.findByUserId(user.userId);
    expect(state).not.toBeNull();
    expect(state!.currentState).toBe('IDLE');
    // TODO: Acceptance criteria references ONBOARDING_START; update when onboarding transition is implemented.
  });

  it('Scenario 2: Valid state transition persists new state, payload, and expiration', async () => {
    const user = await createUser(db);
    await createConversationState(db, { userId: user.userId, currentState: 'IDLE' });

    const transition = new TransitionConversationState(conversationRepo);
    const expiresAt = new Date(Date.now() + 3600_000);

    const result = await transition.execute({
      userId: user.userId,
      targetState: 'EXPENSE_RECEIVING',
      payload: { amount: 1500, concept: 'Almuerzo' },
      expiresAt,
    });

    expect(result.currentState).toBe('EXPENSE_RECEIVING');
    expect(result.statePayload).toEqual({ amount: 1500, concept: 'Almuerzo' });
    expect(result.expiresAt).toEqual(expiresAt);

    const getState = new GetConversationState(conversationRepo);
    const readBack = await getState.execute({ userId: user.userId });

    expect(readBack).not.toBeNull();
    expect(readBack!.currentState).toBe('EXPENSE_RECEIVING');
    expect(readBack!.statePayload).toEqual({ amount: 1500, concept: 'Almuerzo' });
    expect(readBack!.expiresAt).toEqual(expiresAt);
  });

  it('Scenario 3: Session persistence across simulated restarts', async () => {
    const user = await createUser(db);
    const payload = { draft: { amount: 2300, concept: 'Taxi' } };
    await createConversationState(db, {
      userId: user.userId,
      currentState: 'EXPENSE_REVIEW',
      statePayload: payload,
    });

    // Simulate application restart with a fresh DB connection
    const freshPgClient = postgres(getConnectionString(container), { max: 1 });
    const freshDb = drizzle(freshPgClient, { schema });
    const freshRepo = new DrizzleConversationStateRepository(freshDb);
    const getState = new GetConversationState(freshRepo);

    const state = await getState.execute({ userId: user.userId });

    expect(state).not.toBeNull();
    expect(state!.currentState).toBe('EXPENSE_REVIEW');
    expect(state!.statePayload).toEqual(payload);

    await freshPgClient.end();
  });

  it('Scenario 4: Corrupted state recovery logs anomaly and resets to IDLE', async () => {
    const user = await createUser(db);
    await createConversationState(db, {
      userId: user.userId,
      currentState: 'EXPENSE_REVIEW',
    });

    // The DB CHECK constraint blocks invalid states, so we feed the invalid value
    // directly to the use case (boundary mock).
    const useCase = new RecoverCorruptedState(conversationRepo, operationLogRepo);
    const result = await useCase.execute({
      userId: user.userId,
      observedState: 'BOGUS_STATE',
    });

    expect(result.recovered).toBe(true);
    expect(result.message).toBe('Parece que algo falló. Vamos a empezar de nuevo.');

    const state = await conversationRepo.findByUserId(user.userId);
    expect(state).not.toBeNull();
    expect(state!.currentState).toBe('IDLE');

    const logs = await db
      .select()
      .from(schema.operationLogs)
      .where(eq(schema.operationLogs.userId, user.userId));

    expect(logs.length).toBe(1);
    expect(logs[0]!.errorType).toBe('CORRUPTED_STATE');
    expect(logs[0]!.operation).toBe('STATE_CORRUPTED');
    expect(logs[0]!.payload).toEqual({ observedState: 'BOGUS_STATE' });
  });

  it('Scenario 5: Expired session transitions to IDLE and notifies user', async () => {
    const user = await createUser(db);
    const past = new Date(Date.now() - 3600_000); // 1 hour ago
    await createConversationState(db, {
      userId: user.userId,
      currentState: 'EXPENSE_REVIEW',
      expiresAt: past,
    });
    await createMessagingIdentity(db, {
      userId: user.userId,
      channel: 'telegram',
      externalId: '987654321',
    });

    const messagingMock: MessagingOutputPort = {
      sendMessage: vi.fn().mockResolvedValue({ status: 'success' }),
    };

    const transition = new TransitionConversationState(conversationRepo);
    const useCase = new HandleExpiredSessions(
      conversationRepo,
      userRepo,
      transition,
      messagingMock,
    );

    await useCase.execute();

    const state = await conversationRepo.findByUserId(user.userId);
    expect(state).not.toBeNull();
    expect(state!.currentState).toBe('IDLE');

    expect(messagingMock.sendMessage).toHaveBeenCalledWith(
      '987654321',
      'Tu sesion expiro. Queres continuar o empezar de nuevo?',
    );
  });
});

// LAYER: Tests / Integration
// Integration tests for ValidateSpreadsheetAccess use case.
// Runs against a real PostgreSQL database inside a testcontainer.
// Tests the full handler-to-use-case flow including state transitions.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as schema from '../../../src/infrastructure/db/schema';
import {
  startDbContainer,
  stopDbContainer,
  getConnectionString,
  isDockerAvailable,
} from '../helpers/db-container';
import { runMigrations } from '../helpers/migrate';
import { createUser, createConversationState, createSpreadsheetConfig } from '../helpers/fixtures';
import { DrizzleSpreadsheetConfigRepository } from '../../../src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository';
import { DrizzleConversationStateRepository } from '../../../src/infrastructure/db/repositories/DrizzleConversationStateRepository';
import { TransitionConversationState } from '../../../src/application/use-cases/conversation/TransitionConversationState';
import {
  ValidateSpreadsheetAccess,
  type ValidateSpreadsheetAccessDeps,
} from '../../../src/application/use-cases/spreadsheet/ValidateSpreadsheetAccess';
import type {
  ValidateSpreadsheetAccessPortFactory,
  ValidateSpreadsheetAccessPort,
} from '../../../src/domain/ports/spreadsheetAccess';
import type { SpreadsheetAccessResult } from '../../../src/domain/value-objects/SpreadsheetAccessResult';
import type { MessagingOutputPort } from '../../../src/application/ports/output/messaging.port';
import { SpreadsheetError } from '../../../src/domain/errors/SpreadsheetError';
import { SpreadsheetPreview } from '../../../src/domain/entities/SpreadsheetPreview';
import { onboardingCopies } from '../../../src/application/copies/onboarding.copies';

describe.skipIf(!isDockerAvailable())('Integration :: ValidateSpreadsheetAccess', () => {
  let container: StartedPostgreSqlContainer;
  let pgClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let configRepo: DrizzleSpreadsheetConfigRepository;
  let conversationRepo: DrizzleConversationStateRepository;
  let transitionState: TransitionConversationState;

  const mockSendMessage = vi.fn().mockResolvedValue({ status: 'success' });
  const messagingPort: MessagingOutputPort = { sendMessage: mockSendMessage };

  const mockGetValidAccessToken = vi.fn();
  const mockForceRefreshAccessToken = vi.fn();
  const oauthAccessTokenService = {
    getValidAccessToken: mockGetValidAccessToken,
    forceRefreshAccessToken: mockForceRefreshAccessToken,
  } as ValidateSpreadsheetAccessDeps['oauthAccessTokenService'];

  const mockInferColumnMapping = {
    execute: vi.fn().mockResolvedValue({ nextState: 'ONBOARDING_MAPPING', message: '' }),
  } as unknown as ValidateSpreadsheetAccessDeps['inferColumnMapping'];
  const mockLogger = { error: vi.fn() } as unknown as ValidateSpreadsheetAccessDeps['logger'];

  beforeAll(async () => {
    container = await startDbContainer();
    pgClient = postgres(getConnectionString(container), { max: 1 });
    await runMigrations(pgClient);
    db = drizzle(pgClient, { schema });

    configRepo = new DrizzleSpreadsheetConfigRepository(db);
    conversationRepo = new DrizzleConversationStateRepository(db);
    transitionState = new TransitionConversationState(conversationRepo);
  }, 60000);

  afterAll(async () => {
    if (pgClient) await pgClient.end();
    if (container) await stopDbContainer(container);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetValidAccessToken.mockResolvedValue({
      accessToken: 'access-token',
      expiresAt: new Date(Date.now() + 3600_000),
      refreshed: false,
    });
    mockForceRefreshAccessToken.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      expiresAt: new Date(Date.now() + 3600_000),
      refreshed: true,
    });
  });

  function createMockPortFactory(
    result: SpreadsheetAccessResult,
  ): ValidateSpreadsheetAccessPortFactory {
    const mockPort: ValidateSpreadsheetAccessPort = {
      validateSpreadsheetAccess: vi.fn().mockResolvedValue(result),
    };
    return {
      create: vi.fn().mockReturnValue(mockPort),
    };
  }

  function createUseCase(
    portFactory: ValidateSpreadsheetAccessPortFactory,
  ): ValidateSpreadsheetAccess {
    return new ValidateSpreadsheetAccess({
      validateSpreadsheetAccessPortFactory: portFactory,
      oauthAccessTokenService,
      transitionState,
      messagingPort,
      spreadsheetConfigRepository: configRepo,
      inferColumnMapping: mockInferColumnMapping,
      logger: mockLogger,
    });
  }

  const mockPreview = new SpreadsheetPreview({
    provider: 'google',
    fileId: 'file-123',
    sheetName: 'Gastos',
    rows: [{ index: 1, values: ['Fecha', 'Concepto', 'Monto'] }],
  });

  describe('success path', () => {
    it('transitions to ONBOARDING_MAPPING and updates accessVerifiedAt', async () => {
      const user = await createUser(db);
      await createConversationState(db, {
        userId: user.userId,
        currentState: 'ONBOARDING_VALIDATING_ACCESS',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });
      const config = await createSpreadsheetConfig(db, { userId: user.userId });

      const portFactory = createMockPortFactory({ kind: 'success', preview: mockPreview });
      const useCase = createUseCase(portFactory);

      const result = await useCase.execute({
        userId: user.userId,
        externalId: '123456789',
        channel: 'telegram',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });

      expect(result.nextState).toBe('ONBOARDING_MAPPING');
      expect(mockSendMessage).not.toHaveBeenCalled();

      const state = await conversationRepo.findByUserId(user.userId);
      expect(state).not.toBeNull();
      expect(state!.currentState).toBe('ONBOARDING_MAPPING');

      const updatedConfig = await configRepo.findByUserId(user.userId);
      expect(updatedConfig).not.toBeNull();
      expect(updatedConfig!.id).toBe(config.id);
      expect(updatedConfig!.accessVerifiedAt.getTime()).toBeGreaterThan(
        config.accessVerifiedAt.getTime(),
      );
    });
  });

  describe('expired token', () => {
    it('transitions to ONBOARDING_START and sends reconnect message', async () => {
      const user = await createUser(db);
      await createConversationState(db, {
        userId: user.userId,
        currentState: 'ONBOARDING_VALIDATING_ACCESS',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });
      await createSpreadsheetConfig(db, { userId: user.userId });

      const portFactory = createMockPortFactory({ kind: 'success', preview: mockPreview });
      mockGetValidAccessToken.mockRejectedValue(
        new SpreadsheetError('expired authorization', { code: 'AUTH_ERROR' }),
      );
      const useCase = createUseCase(portFactory);

      const result = await useCase.execute({
        userId: user.userId,
        externalId: '123456789',
        channel: 'telegram',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });

      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        onboardingCopies.reconnectAccount(),
      );

      const state = await conversationRepo.findByUserId(user.userId);
      expect(state).not.toBeNull();
      expect(state!.currentState).toBe('ONBOARDING_START');
    });
  });

  describe('read-only access', () => {
    it('stays in ONBOARDING_VALIDATING_ACCESS and sends read-only warning', async () => {
      const user = await createUser(db);
      await createConversationState(db, {
        userId: user.userId,
        currentState: 'ONBOARDING_VALIDATING_ACCESS',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });
      await createSpreadsheetConfig(db, { userId: user.userId });

      const portFactory = createMockPortFactory({ kind: 'read-only', preview: mockPreview });
      const useCase = createUseCase(portFactory);

      const result = await useCase.execute({
        userId: user.userId,
        externalId: '123456789',
        channel: 'telegram',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });

      expect(result.nextState).toBe('ONBOARDING_VALIDATING_ACCESS');
      expect(mockSendMessage).toHaveBeenCalledWith('123456789', onboardingCopies.readOnlyWarning());

      const state = await conversationRepo.findByUserId(user.userId);
      expect(state).not.toBeNull();
      expect(state!.currentState).toBe('ONBOARDING_VALIDATING_ACCESS');
    });
  });

  describe('empty sheet', () => {
    it('transitions to ONBOARDING_SHEET with step empty-sheet-confirm', async () => {
      const user = await createUser(db);
      const sheetList = [{ name: 'Gastos', index: 0 }];
      await createConversationState(db, {
        userId: user.userId,
        currentState: 'ONBOARDING_VALIDATING_ACCESS',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
          sheetList,
        },
      });
      await createSpreadsheetConfig(db, { userId: user.userId });

      const portFactory = createMockPortFactory({ kind: 'empty-sheet' });
      const useCase = createUseCase(portFactory);

      const result = await useCase.execute({
        userId: user.userId,
        externalId: '123456789',
        channel: 'telegram',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
          sheetList,
        },
      });

      expect(result.nextState).toBe('ONBOARDING_SHEET');
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        onboardingCopies.emptySheetConfirm('Gastos'),
      );

      const state = await conversationRepo.findByUserId(user.userId);
      expect(state).not.toBeNull();
      expect(state!.currentState).toBe('ONBOARDING_SHEET');
      expect(state!.statePayload).toMatchObject({
        step: 'empty-sheet-confirm',
        selectedFileId: 'file-123',
        selectedSheetName: 'Gastos',
      });
    });
  });

  describe('authorization recovery', () => {
    it('refreshes once and succeeds on the replayed access check', async () => {
      const user = await createUser(db);
      await createConversationState(db, {
        userId: user.userId,
        currentState: 'ONBOARDING_VALIDATING_ACCESS',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });
      await createSpreadsheetConfig(db, { userId: user.userId });

      const mockValidateAccess = vi
        .fn()
        .mockResolvedValueOnce({
          kind: 'access-error',
          errorType: 'token-expired',
          retryable: true,
        })
        .mockResolvedValueOnce({ kind: 'success', preview: mockPreview });

      const portFactory: ValidateSpreadsheetAccessPortFactory = {
        create: vi.fn().mockReturnValue({
          validateSpreadsheetAccess: mockValidateAccess,
        }),
      };

      const useCase = createUseCase(portFactory);

      const result = await useCase.execute({
        userId: user.userId,
        externalId: '123456789',
        channel: 'telegram',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });

      expect(mockValidateAccess).toHaveBeenCalledTimes(2);
      expect(mockForceRefreshAccessToken).toHaveBeenCalledWith({
        userId: user.userId,
        provider: 'google',
        requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      expect(result.nextState).toBe('ONBOARDING_MAPPING');

      const state = await conversationRepo.findByUserId(user.userId);
      expect(state).not.toBeNull();
      expect(state!.currentState).toBe('ONBOARDING_MAPPING');
    });

    it('transitions to ONBOARDING_START when the replayed access check still fails', async () => {
      const user = await createUser(db);
      await createConversationState(db, {
        userId: user.userId,
        currentState: 'ONBOARDING_VALIDATING_ACCESS',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });
      await createSpreadsheetConfig(db, { userId: user.userId });

      const mockValidateAccess = vi.fn().mockResolvedValue({
        kind: 'access-error',
        errorType: 'token-expired',
        retryable: true,
      });

      const portFactory: ValidateSpreadsheetAccessPortFactory = {
        create: vi.fn().mockReturnValue({
          validateSpreadsheetAccess: mockValidateAccess,
        }),
      };

      const useCase = createUseCase(portFactory);

      const result = await useCase.execute({
        userId: user.userId,
        externalId: '123456789',
        channel: 'telegram',
        statePayload: {
          selectedFileId: 'file-123',
          selectedFileName: 'Mi Planilla',
          selectedSheetName: 'Gastos',
          provider: 'google',
        },
      });

      expect(mockValidateAccess).toHaveBeenCalledTimes(2);
      expect(mockForceRefreshAccessToken).toHaveBeenCalledOnce();
      expect(result.nextState).toBe('ONBOARDING_START');
      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456789',
        onboardingCopies.reconnectAccount(),
      );

      const state = await conversationRepo.findByUserId(user.userId);
      expect(state).not.toBeNull();
      expect(state!.currentState).toBe('ONBOARDING_START');
    });
  });
});

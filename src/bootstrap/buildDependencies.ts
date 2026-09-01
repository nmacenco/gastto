// LAYER: Bootstrap
// Wires repositories, use cases, queues and optional feature bundles.

import { Queue } from 'bullmq';

import type { Env } from '../config/env.schema';
import type { Dependencies, DrizzleDatabase, GoogleOAuthFeature, TelegramFeature } from './types';

// Infrastructure
import { DrizzleUserRepository } from '../infrastructure/db/repositories/DrizzleUserRepository';
import { DrizzleUserProfileRepository } from '../infrastructure/db/repositories/DrizzleUserProfileRepository';
import { DrizzleConversationStateRepository } from '../infrastructure/db/repositories/DrizzleConversationStateRepository';
import { DrizzleOperationLogRepository } from '../infrastructure/db/repositories/DrizzleOperationLogRepository';
import { DrizzleOAuthTokenRepository } from '../infrastructure/db/repositories/DrizzleOAuthTokenRepository';
import { DrizzleSpreadsheetConfigRepository } from '../infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository';
import { DrizzleColumnMappingRepository } from '../infrastructure/db/repositories/DrizzleColumnMappingRepository';
import { DrizzleCategoryVocabularyRepository } from '../infrastructure/db/repositories/DrizzleCategoryVocabularyRepository';
import { DrizzleCategoryKeywordVocabularyRepository } from '../infrastructure/db/repositories/DrizzleCategoryKeywordVocabularyRepository';
import { DrizzleUserCategoryRepository } from '../infrastructure/db/repositories/DrizzleUserCategoryRepository';
import { DrizzleExpenseRecordRepository } from '../infrastructure/db/repositories/DrizzleExpenseRecordRepository';
import { DrizzleExpenseQueueRepository } from '../infrastructure/db/repositories/DrizzleExpenseQueueRepository';
import { TelegramMessengerAdapter } from '../infrastructure/adapters/telegram/TelegramMessengerAdapter';
import { CategoryFallbackMapper } from '../infrastructure/adapters/category/CategoryFallbackMapper';
import { GoogleDriveOAuthAdapter } from '../infrastructure/adapters/oauth';
import { GoogleDriveFileDiscoveryAdapter } from '../infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter';
import { GoogleSheetsAdapterFactory } from '../infrastructure/adapters/sheets/GoogleSheetsAdapterFactory';
import { SpreadsheetAccessAdapterFactory } from '../infrastructure/adapters/sheets/SpreadsheetAccessAdapterFactory';
import { GoogleSheetsAdapter } from '../infrastructure/adapters/sheets/GoogleSheetsAdapter';
import { SpreadsheetCategoryReaderFactory } from '../infrastructure/adapters/sheets/SpreadsheetCategoryReaderFactory';
import { RegexCategoryModificationParser } from '../infrastructure/adapters/RegexCategoryModificationParser';
import { RuleBasedColumnInferenceAdapter } from '../infrastructure/adapters/sheets/RuleBasedColumnInferenceAdapter';
import { RuleBasedHeaderDetectionAdapter } from '../infrastructure/adapters/sheets/RuleBasedHeaderDetectionAdapter';
import { LLMHeaderDetectionAdapter } from '../infrastructure/adapters/sheets/LLMHeaderDetectionAdapter';
import { LLMColumnInferenceAdapter } from '../infrastructure/adapters/sheets/LLMColumnInferenceAdapter';
import { OpenAIAdapter } from '../infrastructure/adapters/llm/OpenAIAdapter';
import { ClaudeAdapter } from '../infrastructure/adapters/llm/ClaudeAdapter';
import { NvidiaAdapter } from '../infrastructure/adapters/llm/NvidiaAdapter';
import { RuleBasedColumnMappingCorrectionParser } from '../application/services/ColumnMappingCorrectionParser';
import {
  OAuthAccessTokenService,
  type OAuthAccessTokenProvider,
} from '../application/services/OAuthAccessTokenService';
import { TokenEncryptionAdapter } from '../infrastructure/security/TokenEncryptionAdapter';
import { RedisMappingCorrectionStateRepository } from '../infrastructure/redis/RedisMappingCorrectionStateRepository';
import { RedisProcessedMessageRepository } from '../infrastructure/redis/RedisProcessedMessageRepository';
import { RedisUserProcessingLock } from '../infrastructure/redis/RedisUserProcessingLock';

// Application
import { RegisterExpenseUseCase } from '../application/use-cases/expense/RegisterExpense';
import { CorrectExpenseUseCase } from '../application/use-cases/expense/CorrectExpenseUseCase';
import { GenerateExpenseSummaryUseCase } from '../application/use-cases/expense/GenerateExpenseSummaryUseCase';
import { ResolveExpenseSummaryActionUseCase } from '../application/use-cases/expense/ResolveExpenseSummaryActionUseCase';
import { CancelExpenseRegistrationUseCase } from '../application/use-cases/expense/CancelExpenseRegistrationUseCase';
import { ResolveExpenseReviewReplyUseCase } from '../application/use-cases/expense/ResolveExpenseReviewReplyUseCase';
import { UndoLastExpenseUseCase } from '../application/use-cases/expense/UndoLastExpense';
import { RetryExpenseSaveUseCase } from '../application/use-cases/expense/RetryExpenseSaveUseCase';
import { QueuePendingExpense } from '../application/use-cases/expense/QueuePendingExpense';
import { AdvancePendingExpense } from '../application/use-cases/expense/AdvancePendingExpense';
import { ClassifyExpenseCategory } from '../application/use-cases/expense/ClassifyExpenseCategory';
import { TelegramExpenseSummaryPresenter } from '../infrastructure/adapters/telegram/TelegramExpenseSummaryPresenter';
import { ResolveUserIdentityUseCase } from '../application/use-cases/user/ResolveUserIdentity';
import { InitiateCloudConnection } from '../application/use-cases/spreadsheet/InitiateCloudConnection';
import { HandleOAuthCallback } from '../application/use-cases/spreadsheet/HandleOAuthCallback';
import { SendOAuthReminder } from '../application/use-cases/spreadsheet/SendOAuthReminder';
import { CancelCloudConnection } from '../application/use-cases/spreadsheet/CancelCloudConnection';
import { HandleSpreadsheetFileSelection } from '../application/use-cases/spreadsheet/HandleSpreadsheetFileSelection';
import { HandleSheetSelection } from '../application/use-cases/spreadsheet/HandleSheetSelection';
import { ValidateSpreadsheetAccess } from '../application/use-cases/spreadsheet/ValidateSpreadsheetAccess';
import { StartSpreadsheetReconfigurationUseCase } from '../application/use-cases/spreadsheet/StartSpreadsheetReconfigurationUseCase';
import { InferColumnMapping } from '../application/use-cases/spreadsheet/InferColumnMapping';
import { ConfirmColumnMapping } from '../application/use-cases/spreadsheet/ConfirmColumnMapping';
import { CorrectColumnMapping } from '../application/use-cases/spreadsheet/CorrectColumnMapping';
import { DetectCategories } from '../application/use-cases/spreadsheet/DetectCategories';
import { ConfirmCategories } from '../application/use-cases/spreadsheet/ConfirmCategories';
import { ModifyCategoryVocabulary } from '../application/use-cases/spreadsheet/ModifyCategoryVocabulary';
import { HandleStartCommand } from '../application/use-cases/conversation/HandleStartCommand';
import { HandleUnsupportedMessage } from '../application/use-cases/conversation/HandleUnsupportedMessage';
import { ClassifyFreeTextExpenseIntent } from '../application/use-cases/conversation/ClassifyFreeTextExpenseIntent';
import { SendExpenseGuidance } from '../application/use-cases/conversation/SendExpenseGuidance';
import { SendImmediateAcknowledgement } from '../application/use-cases/conversation/SendImmediateAcknowledgement';
import { RouteIncomingMessage } from '../application/use-cases/conversation/RouteIncomingMessage';
import { TransitionConversationState } from '../application/use-cases/conversation/TransitionConversationState';
import { RecoverCorruptedState } from '../application/use-cases/conversation/RecoverCorruptedState';
import { GetConversationState } from '../application/use-cases/conversation/GetConversationState';

import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { ProcessMessageJobData } from '../application/ports/ProcessMessageJob';
import type { IncomingMessageJobData } from '../application/ports/IncomingMessageJob';
import type { LLMPort } from '../domain/ports/services';
import type { MessagingOutputPort } from '../application/ports/output/messaging.port';
import { registerBullMqErrorListener } from '../interfaces/workers/bullMqRuntime';
import { SpreadsheetError } from '../domain/errors/SpreadsheetError';

/** Core infrastructure required to build the dependency graph. */
export interface BuildDependenciesInfra {
  db: DrizzleDatabase;
  redis: Redis;
  rootLogger: Logger;
}

function createLLMPort(env: Env): LLMPort {
  if (env.NVIDIA_API_KEY !== undefined && env.NVIDIA_API_KEY.length > 0) {
    return new NvidiaAdapter(env.NVIDIA_API_KEY);
  }
  if (env.ANTHROPIC_API_KEY !== undefined && env.ANTHROPIC_API_KEY.length > 0) {
    return new ClaudeAdapter(env.ANTHROPIC_API_KEY);
  }
  if (env.OPENAI_API_KEY !== undefined && env.OPENAI_API_KEY.length > 0) {
    return new OpenAIAdapter(env.OPENAI_API_KEY);
  }
  throw new Error(
    'At least one LLM provider API key must be configured: NVIDIA_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.',
  );
}

function buildTelegramFeature(
  env: Env,
  infra: BuildDependenciesInfra,
  core: {
    messageQueue: Queue<ProcessMessageJobData>;
    resolveIdentity: ResolveUserIdentityUseCase;
    getConversationState: GetConversationState;
    conversationRepo: DrizzleConversationStateRepository;
  },
): TelegramFeature | null {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return null;
  }

  const adapter = new TelegramMessengerAdapter(env.TELEGRAM_BOT_TOKEN, infra.rootLogger);
  const handleStartCommand = new HandleStartCommand(adapter, core.conversationRepo);
  const sendImmediateAcknowledgement = new SendImmediateAcknowledgement(adapter);
  const handleUnsupportedMessage = new HandleUnsupportedMessage(adapter);
  const classifyFreeTextExpenseIntent = new ClassifyFreeTextExpenseIntent();
  const sendExpenseGuidance = new SendExpenseGuidance(adapter);
  const processedMessageRepository = new RedisProcessedMessageRepository(infra.redis);

  const routeIncomingMessage = new RouteIncomingMessage({
    messageQueue: core.messageQueue,
    resolveIdentity: core.resolveIdentity,
    handleUnsupportedMessage,
    classifyFreeTextExpenseIntent,
    sendGuidance: sendExpenseGuidance,
    getConversationState: core.getConversationState,
    processedMessageRepository,
  });

  return {
    adapter,
    handleStartCommand,
    sendImmediateAcknowledgement,
    handleUnsupportedMessage,
    classifyFreeTextExpenseIntent,
    sendExpenseGuidance,
    processedMessageRepository,
    routeIncomingMessage,
  };
}

function buildGoogleOAuthFeature(
  env: Env,
  infra: BuildDependenciesInfra,
  core: {
    tokenRepo: DrizzleOAuthTokenRepository;
    conversationRepo: DrizzleConversationStateRepository;
    userRepo: DrizzleUserRepository;
    spreadsheetConfigRepo: DrizzleSpreadsheetConfigRepository;
    columnMappingRepo: DrizzleColumnMappingRepository;
    categoryVocabularyRepo: DrizzleCategoryVocabularyRepository;
    tokenEncryption: TokenEncryptionAdapter;
    transitionState: TransitionConversationState;
    reminderQueue: Queue;
    ruleBasedColumnInferenceAdapter: RuleBasedColumnInferenceAdapter;
    ruleBasedHeaderDetectionAdapter: RuleBasedHeaderDetectionAdapter;
    llmColumnInferenceAdapter: LLMColumnInferenceAdapter;
    llmHeaderDetectionAdapter: LLMHeaderDetectionAdapter;
    telegramAdapter: TelegramMessengerAdapter | null;
    oauthAdapter: GoogleDriveOAuthAdapter | null;
    oauthAccessTokenService: OAuthAccessTokenProvider;
  },
): GoogleOAuthFeature | null {
  if (!env.GOOGLE_REDIRECT_URI || !core.telegramAdapter || !core.oauthAdapter) {
    return null;
  }

  const adapter = core.oauthAdapter;

  const messagingPort = core.telegramAdapter;

  const initiateCloudConnection = new InitiateCloudConnection({
    oauthService: adapter,
    redis: infra.redis,
    reminderQueue: core.reminderQueue,
    transitionState: core.transitionState,
    messagingPort,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  });

  const sendOAuthReminder = new SendOAuthReminder({
    redis: infra.redis,
    oauthService: adapter,
    oauthAccessTokenService: core.oauthAccessTokenService,
    conversationRepo: core.conversationRepo,
    reminderQueue: core.reminderQueue,
    transitionState: core.transitionState,
    messagingPort,
  });

  const cancelCloudConnection = new CancelCloudConnection({
    redis: infra.redis,
    reminderQueue: core.reminderQueue,
    transitionState: core.transitionState,
    messagingPort,
    logger: infra.rootLogger,
  });

  const driveFileDiscovery = new GoogleDriveFileDiscoveryAdapter(infra.rootLogger);
  const sheetsAdapterFactory = new GoogleSheetsAdapterFactory();
  const categoryReaderFactory = new SpreadsheetCategoryReaderFactory(sheetsAdapterFactory);

  const inferColumnMapping = new InferColumnMapping({
    oauthAccessTokenService: core.oauthAccessTokenService,
    spreadsheetConfigRepository: core.spreadsheetConfigRepo,
    columnMappingRepository: core.columnMappingRepo,
    columnInferencePort: core.ruleBasedColumnInferenceAdapter,
    llmColumnInferencePort: core.llmColumnInferenceAdapter,
    headerDetectionPort: core.ruleBasedHeaderDetectionAdapter,
    llmHeaderDetectionPort: core.llmHeaderDetectionAdapter,
    messagingPort,
    transitionState: core.transitionState,
  });

  const validateSpreadsheetAccess = new ValidateSpreadsheetAccess({
    validateSpreadsheetAccessPortFactory: new SpreadsheetAccessAdapterFactory(),
    oauthAccessTokenService: core.oauthAccessTokenService,
    transitionState: core.transitionState,
    messagingPort,
    spreadsheetConfigRepository: core.spreadsheetConfigRepo,
    inferColumnMapping,
    logger: infra.rootLogger,
  });

  const startSpreadsheetReconfiguration = new StartSpreadsheetReconfigurationUseCase({
    spreadsheetConfigRepository: core.spreadsheetConfigRepo,
    transitionState: core.transitionState,
    validateSpreadsheetAccess,
    messagingPort,
  });

  const handleSheetSelection = new HandleSheetSelection({
    spreadsheetPortFactory: sheetsAdapterFactory,
    oauthAccessTokenService: core.oauthAccessTokenService,
    transitionState: core.transitionState,
    messagingPort,
    spreadsheetConfigRepository: core.spreadsheetConfigRepo,
    validateSpreadsheetAccess,
    logger: infra.rootLogger,
  });

  const handleSpreadsheetFileSelection = new HandleSpreadsheetFileSelection({
    cloudStorage: driveFileDiscovery,
    oauthAccessTokenService: core.oauthAccessTokenService,
    transitionState: core.transitionState,
    messagingPort,
    logger: infra.rootLogger,
    handleSheetSelection,
  });

  const handleOAuthCallback = new HandleOAuthCallback({
    redis: infra.redis,
    logger: infra.rootLogger,
    oauthService: adapter,
    tokenRepository: core.tokenRepo,
    reminderQueue: core.reminderQueue,
    transitionState: core.transitionState,
    messagingPort,
    tokenEncryption: core.tokenEncryption,
    handleSpreadsheetFileSelection,
  });

  const mappingCorrectionStateRepository = new RedisMappingCorrectionStateRepository(infra.redis);

  const confirmColumnMapping = new ConfirmColumnMapping({
    columnMappingRepository: core.columnMappingRepo,
    correctionStateRepository: mappingCorrectionStateRepository,
    spreadsheetConfigRepository: core.spreadsheetConfigRepo,
    messagingPort,
    transitionState: core.transitionState,
  });

  const correctColumnMapping = new CorrectColumnMapping({
    columnMappingRepository: core.columnMappingRepo,
    spreadsheetConfigRepository: core.spreadsheetConfigRepo,
    oauthAccessTokenService: core.oauthAccessTokenService,
    spreadsheetColumnPort: new GoogleSheetsAdapter(''),
    correctionParser: new RuleBasedColumnMappingCorrectionParser(),
    correctionStateRepository: mappingCorrectionStateRepository,
    headerDetectionPort: core.ruleBasedHeaderDetectionAdapter,
    llmHeaderDetectionPort: core.llmHeaderDetectionAdapter,
    llmColumnInferencePort: core.llmColumnInferenceAdapter,
    messagingPort,
    transitionState: core.transitionState,
    stateTtlSeconds: env.MAPPING_CORRECTION_TTL_SECONDS,
  });

  const detectCategories = new DetectCategories({
    categoryReaderPortFactory: categoryReaderFactory,
    oauthAccessTokenService: core.oauthAccessTokenService,
    spreadsheetConfigRepository: core.spreadsheetConfigRepo,
    columnMappingRepository: core.columnMappingRepo,
    messagingPort,
    transitionState: core.transitionState,
    categoryVocabularyRepository: core.categoryVocabularyRepo,
  });

  const confirmCategories = new ConfirmCategories({
    spreadsheetConfigRepository: core.spreadsheetConfigRepo,
    userRepository: core.userRepo,
    messagingPort,
    transitionState: core.transitionState,
  });

  const modifyCategoryVocabulary = new ModifyCategoryVocabulary({
    categoryModificationParser: new RegexCategoryModificationParser(),
    spreadsheetConfigRepository: core.spreadsheetConfigRepo,
    categoryVocabularyRepository: core.categoryVocabularyRepo,
    messagingPort,
    transitionState: core.transitionState,
  });

  return {
    adapter,
    initiateCloudConnection,
    handleOAuthCallback,
    sendOAuthReminder,
    cancelCloudConnection,
    driveFileDiscovery,
    sheetsAdapterFactory,
    categoryReaderFactory,
    handleSpreadsheetFileSelection,
    handleSheetSelection,
    validateSpreadsheetAccess,
    startSpreadsheetReconfiguration,
    inferColumnMapping,
    confirmColumnMapping,
    correctColumnMapping,
    detectCategories,
    confirmCategories,
    modifyCategoryVocabulary,
  };
}

/**
 * Builds the full dependency graph from infrastructure and environment.
 *
 * Returns `telegram: null` when Telegram is not configured and
 * `googleOAuth: null` when Google OAuth credentials are missing.
 */
export function buildDependencies(env: Env, infra: BuildDependenciesInfra): Dependencies {
  // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
  const userRepo = new DrizzleUserRepository(infra.db, infra.redis);
  // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
  const conversationRepo = new DrizzleConversationStateRepository(infra.db);
  // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
  const operationLogRepo = new DrizzleOperationLogRepository(infra.db);
  // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
  const tokenRepo = new DrizzleOAuthTokenRepository(infra.db);
  // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
  const spreadsheetConfigRepo = new DrizzleSpreadsheetConfigRepository(infra.db);
  // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
  const columnMappingRepo = new DrizzleColumnMappingRepository(infra.db);
  // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
  const categoryVocabularyRepo = new DrizzleCategoryVocabularyRepository(infra.db);
  // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
  const userCategoryRepo = new DrizzleUserCategoryRepository(infra.db);
  // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
  const expenseRecordRepo = new DrizzleExpenseRecordRepository(infra.db);
  // @ts-expect-error TODO: schema type mismatch until all tables are defined in drizzle schema
  const expenseQueueRepo = new DrizzleExpenseQueueRepository(infra.db);

  const tokenEncryption = new TokenEncryptionAdapter(env.ENCRYPTION_KEY);
  const googleOAuthAdapter =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI
      ? new GoogleDriveOAuthAdapter({
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: env.GOOGLE_REDIRECT_URI,
        })
      : null;
  const unavailableOAuthAccessTokenProvider: OAuthAccessTokenProvider = {
    getValidAccessToken: () =>
      Promise.reject(
        new SpreadsheetError('OAuth provider is not configured', { code: 'AUTH_ERROR' }),
      ),
    forceRefreshAccessToken: () =>
      Promise.reject(
        new SpreadsheetError('OAuth provider is not configured', { code: 'AUTH_ERROR' }),
      ),
  };
  const oauthAccessTokenService: OAuthAccessTokenProvider = googleOAuthAdapter
    ? new OAuthAccessTokenService({
        tokenRepository: tokenRepo,
        tokenEncryption,
        oauthService: googleOAuthAdapter,
      })
    : unavailableOAuthAccessTokenProvider;

  const resolveIdentity = new ResolveUserIdentityUseCase(userRepo, conversationRepo);
  const getConversationState = new GetConversationState(conversationRepo);
  const transitionState = new TransitionConversationState(conversationRepo);
  const recoverCorruptedState = new RecoverCorruptedState(conversationRepo, operationLogRepo);

  // process-message jobs run side-effectful FSM handlers that send
  // user-facing messages. Retrying them re-runs those side effects and
  // can duplicate outbound messages (see ADR-015). The worker wraps the
  // handler in a try/catch and surfaces a single fallback message, so
  // non-lock errors must NOT be retried.
  // A custom backoff strategy (registered on the Worker) returns -1 for
  // every error except UserAlreadyProcessingError, ensuring only lock
  // contention triggers a retry with exponential backoff.
  const messageQueue = new Queue<ProcessMessageJobData>('process-message', {
    connection: infra.redis,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'custom' },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  registerBullMqErrorListener(messageQueue, {
    logger: infra.rootLogger,
    queue: 'process-message',
    resourceKind: 'queue',
  });

  const incomingMessageQueue = new Queue<IncomingMessageJobData>('incoming-message', {
    connection: infra.redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  registerBullMqErrorListener(incomingMessageQueue, {
    logger: infra.rootLogger,
    queue: 'incoming-message',
    resourceKind: 'queue',
  });

  const reminderQueue = new Queue('oauth-reminder', {
    connection: infra.redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  registerBullMqErrorListener(reminderQueue, {
    logger: infra.rootLogger,
    queue: 'oauth-reminder',
    resourceKind: 'queue',
  });

  const llmPort = createLLMPort(env);
  const llmHeaderDetectionAdapter = new LLMHeaderDetectionAdapter(llmPort, infra.rootLogger);
  const llmColumnInferenceAdapter = new LLMColumnInferenceAdapter(llmPort, infra.rootLogger);

  const ruleBasedColumnInferenceAdapter = new RuleBasedColumnInferenceAdapter();
  const ruleBasedHeaderDetectionAdapter = new RuleBasedHeaderDetectionAdapter();

  const mappingCorrectionStateRepository = new RedisMappingCorrectionStateRepository(infra.redis);
  const userProcessingLock = new RedisUserProcessingLock(infra.redis);

  const userProfileRepo = new DrizzleUserProfileRepository(userRepo);

  const categoryKeywordVocabularyRepo = new DrizzleCategoryKeywordVocabularyRepository(
    spreadsheetConfigRepo,
    userCategoryRepo,
  );
  const categoryFallbackMapper = new CategoryFallbackMapper();
  const categoryClassifier = new ClassifyExpenseCategory(
    categoryKeywordVocabularyRepo,
    categoryFallbackMapper,
    env.CATEGORY_CLASSIFICATION_CONFIDENCE_THRESHOLD,
  );
  const spreadsheetPortFactory = new GoogleSheetsAdapterFactory();

  const registerExpense = new RegisterExpenseUseCase(
    llmPort,
    spreadsheetPortFactory,
    expenseRecordRepo,
    spreadsheetConfigRepo,
    columnMappingRepo,
    userCategoryRepo,
    conversationRepo,
    operationLogRepo,
    userProfileRepo,
    categoryClassifier,
    oauthAccessTokenService,
    env.EXPENSE_REVIEW_TIMEOUT_MINUTES,
  );
  const queuePendingExpense = new QueuePendingExpense(expenseQueueRepo);

  const generateExpenseSummary = new GenerateExpenseSummaryUseCase(
    expenseRecordRepo,
    env.HIGH_AMOUNT_THRESHOLD_MULTIPLIER,
  );
  const undoLastExpense = new UndoLastExpenseUseCase(
    spreadsheetPortFactory,
    expenseRecordRepo,
    spreadsheetConfigRepo,
    operationLogRepo,
    oauthAccessTokenService,
  );
  const correctExpense = new CorrectExpenseUseCase(
    {
      llm: llmPort,
      classifier: categoryClassifier,
      expenseRepo: expenseRecordRepo,
      spreadsheetConfigRepo,
      categoryRepo: userCategoryRepo,
      transitionState,
    },
    env.EXPENSE_REVIEW_TIMEOUT_MINUTES,
  );

  const telegram = buildTelegramFeature(env, infra, {
    messageQueue,
    resolveIdentity,
    getConversationState,
    conversationRepo,
  });

  const googleOAuth = buildGoogleOAuthFeature(env, infra, {
    tokenRepo,
    conversationRepo,
    userRepo,
    spreadsheetConfigRepo,
    columnMappingRepo,
    categoryVocabularyRepo,
    tokenEncryption,
    transitionState,
    reminderQueue,
    ruleBasedColumnInferenceAdapter,
    ruleBasedHeaderDetectionAdapter,
    llmColumnInferenceAdapter,
    llmHeaderDetectionAdapter,
    telegramAdapter: telegram?.adapter ?? null,
    oauthAdapter: googleOAuthAdapter,
    oauthAccessTokenService,
  });

  const messagingPort = telegram?.adapter ?? {
    sendMessage: () =>
      Promise.resolve({ status: 'failure' as const, errorCode: 'NO_MESSAGING_ADAPTER' }),
  };
  const expenseSummaryPresenterFactory = (messaging: MessagingOutputPort, chatId: string) =>
    new TelegramExpenseSummaryPresenter(messaging, telegram!.adapter, chatId);
  const advancePendingExpense = new AdvancePendingExpense({
    expenseQueueRepository: expenseQueueRepo,
    registerExpense,
    generateExpenseSummary,
    messagingPort,
    expenseSummaryPresenterFactory,
  });
  const cancelExpenseRegistration = new CancelExpenseRegistrationUseCase({
    transitionState,
    messagingPort,
    advancePendingExpense,
  });
  const retryExpenseSave = new RetryExpenseSaveUseCase({
    registerExpense,
    transitionState,
    messagingPort,
    operationLogRepo,
  });
  const resolveExpenseSummaryAction = new ResolveExpenseSummaryActionUseCase({
    registerExpense,
    transitionState,
    messagingPort,
    cancelExpenseRegistration,
    operationLogRepo,
    advancePendingExpense,
  });
  const resolveExpenseReviewReply = new ResolveExpenseReviewReplyUseCase({
    resolveExpenseSummaryAction,
    correctExpense,
    queuePendingExpense,
    expenseQueueRepository: expenseQueueRepo,
  });

  return {
    db: infra.db,
    redis: infra.redis,
    rootLogger: infra.rootLogger,
    userRepo,
    conversationRepo,
    operationLogRepo,
    tokenRepo,
    spreadsheetConfigRepo,
    columnMappingRepo,
    categoryVocabularyRepo,
    userCategoryRepo,
    expenseRecordRepo,
    expenseQueueRepo,
    tokenEncryption,
    oauthAccessTokenService,
    resolveIdentity,
    getConversationState,
    transitionState,
    recoverCorruptedState,
    messageQueue,
    incomingMessageQueue,
    reminderQueue,
    llmPort,
    llmHeaderDetectionAdapter,
    llmColumnInferenceAdapter,
    spreadsheetAccessAdapterFactory: new SpreadsheetAccessAdapterFactory(),
    ruleBasedColumnInferenceAdapter,
    ruleBasedHeaderDetectionAdapter,
    mappingCorrectionStateRepository,
    userProcessingLock,
    registerExpense,
    queuePendingExpense,
    advancePendingExpense,
    correctExpense,
    generateExpenseSummary,
    resolveExpenseSummaryAction,
    cancelExpenseRegistration,
    resolveExpenseReviewReply,
    undoLastExpense,
    retryExpenseSave,
    expenseSummaryPresenterFactory,
    telegram,
    googleOAuth,
  };
}

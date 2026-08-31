// LAYER: Bootstrap
// Shared types for the decomposed bootstrap modules.

import type { drizzle } from 'drizzle-orm/postgres-js';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

import type { DrizzleUserRepository } from '../infrastructure/db/repositories/DrizzleUserRepository';
import type { DrizzleConversationStateRepository } from '../infrastructure/db/repositories/DrizzleConversationStateRepository';
import type { DrizzleOperationLogRepository } from '../infrastructure/db/repositories/DrizzleOperationLogRepository';
import type { DrizzleOAuthTokenRepository } from '../infrastructure/db/repositories/DrizzleOAuthTokenRepository';
import type { DrizzleSpreadsheetConfigRepository } from '../infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository';
import type { DrizzleColumnMappingRepository } from '../infrastructure/db/repositories/DrizzleColumnMappingRepository';
import type { DrizzleCategoryVocabularyRepository } from '../infrastructure/db/repositories/DrizzleCategoryVocabularyRepository';
import type { DrizzleUserCategoryRepository } from '../infrastructure/db/repositories/DrizzleUserCategoryRepository';
import type { DrizzleExpenseRecordRepository } from '../infrastructure/db/repositories/DrizzleExpenseRecordRepository';
import type { DrizzleExpenseQueueRepository } from '../infrastructure/db/repositories/DrizzleExpenseQueueRepository';
import type { TelegramMessengerAdapter } from '../infrastructure/adapters/telegram/TelegramMessengerAdapter';
import type { GoogleDriveOAuthAdapter } from '../infrastructure/adapters/oauth';
import type { GoogleDriveFileDiscoveryAdapter } from '../infrastructure/adapters/drive/GoogleDriveFileDiscoveryAdapter';
import type { GoogleSheetsAdapterFactory } from '../infrastructure/adapters/sheets/GoogleSheetsAdapterFactory';
import type { SpreadsheetAccessAdapterFactory } from '../infrastructure/adapters/sheets/SpreadsheetAccessAdapterFactory';
import type { SpreadsheetCategoryReaderFactory } from '../infrastructure/adapters/sheets/SpreadsheetCategoryReaderFactory';
import type { RuleBasedColumnInferenceAdapter } from '../infrastructure/adapters/sheets/RuleBasedColumnInferenceAdapter';
import type { RuleBasedHeaderDetectionAdapter } from '../infrastructure/adapters/sheets/RuleBasedHeaderDetectionAdapter';
import type { LLMHeaderDetectionAdapter } from '../infrastructure/adapters/sheets/LLMHeaderDetectionAdapter';
import type { LLMColumnInferenceAdapter } from '../infrastructure/adapters/sheets/LLMColumnInferenceAdapter';
import type { TokenEncryptionAdapter } from '../infrastructure/security/TokenEncryptionAdapter';
import type { RedisMappingCorrectionStateRepository } from '../infrastructure/redis/RedisMappingCorrectionStateRepository';
import type { RedisProcessedMessageRepository } from '../infrastructure/redis/RedisProcessedMessageRepository';
import type { RedisUserProcessingLock } from '../infrastructure/redis/RedisUserProcessingLock';
import type { RegisterExpenseUseCase } from '../application/use-cases/expense/RegisterExpense';
import type { CorrectExpenseUseCase } from '../application/use-cases/expense/CorrectExpenseUseCase';
import type { GenerateExpenseSummaryUseCase } from '../application/use-cases/expense/GenerateExpenseSummaryUseCase';
import type { ResolveExpenseSummaryActionUseCase } from '../application/use-cases/expense/ResolveExpenseSummaryActionUseCase';
import type { CancelExpenseRegistrationUseCase } from '../application/use-cases/expense/CancelExpenseRegistrationUseCase';
import type { ResolveExpenseReviewReplyUseCase } from '../application/use-cases/expense/ResolveExpenseReviewReplyUseCase';
import type { UndoLastExpenseUseCase } from '../application/use-cases/expense/UndoLastExpense';
import type { RetryExpenseSaveUseCase } from '../application/use-cases/expense/RetryExpenseSaveUseCase';
import type { QueuePendingExpense } from '../application/use-cases/expense/QueuePendingExpense';
import type { AdvancePendingExpense } from '../application/use-cases/expense/AdvancePendingExpense';
import type { ExpenseSummaryPresenter } from '../application/ports/output/expense-summary.presenter';
import type { ResolveUserIdentityUseCase } from '../application/use-cases/user/ResolveUserIdentity';
import type { InitiateCloudConnection } from '../application/use-cases/spreadsheet/InitiateCloudConnection';
import type { HandleOAuthCallback } from '../application/use-cases/spreadsheet/HandleOAuthCallback';
import type { SendOAuthReminder } from '../application/use-cases/spreadsheet/SendOAuthReminder';
import type { CancelCloudConnection } from '../application/use-cases/spreadsheet/CancelCloudConnection';
import type { HandleSpreadsheetFileSelection } from '../application/use-cases/spreadsheet/HandleSpreadsheetFileSelection';
import type { HandleSheetSelection } from '../application/use-cases/spreadsheet/HandleSheetSelection';
import type { ValidateSpreadsheetAccess } from '../application/use-cases/spreadsheet/ValidateSpreadsheetAccess';
import type { StartSpreadsheetReconfigurationUseCase } from '../application/use-cases/spreadsheet/StartSpreadsheetReconfigurationUseCase';
import type { InferColumnMapping } from '../application/use-cases/spreadsheet/InferColumnMapping';
import type { ConfirmColumnMapping } from '../application/use-cases/spreadsheet/ConfirmColumnMapping';
import type { CorrectColumnMapping } from '../application/use-cases/spreadsheet/CorrectColumnMapping';
import type { DetectCategories } from '../application/use-cases/spreadsheet/DetectCategories';
import type { ConfirmCategories } from '../application/use-cases/spreadsheet/ConfirmCategories';
import type { ModifyCategoryVocabulary } from '../application/use-cases/spreadsheet/ModifyCategoryVocabulary';
import type { HandleStartCommand } from '../application/use-cases/conversation/HandleStartCommand';
import type { HandleUnsupportedMessage } from '../application/use-cases/conversation/HandleUnsupportedMessage';
import type { ClassifyFreeTextExpenseIntent } from '../application/use-cases/conversation/ClassifyFreeTextExpenseIntent';
import type { SendExpenseGuidance } from '../application/use-cases/conversation/SendExpenseGuidance';
import type { SendImmediateAcknowledgement } from '../application/use-cases/conversation/SendImmediateAcknowledgement';
import type { RouteIncomingMessage } from '../application/use-cases/conversation/RouteIncomingMessage';
import type { TransitionConversationState } from '../application/use-cases/conversation/TransitionConversationState';
import type { RecoverCorruptedState } from '../application/use-cases/conversation/RecoverCorruptedState';
import type { GetConversationState } from '../application/use-cases/conversation/GetConversationState';
import type { LLMPort } from '../domain/ports/services';
import type { ProcessMessageJobData } from '../application/ports/ProcessMessageJob';
import type { IncomingMessageJobData } from '../application/ports/IncomingMessageJob';
import type { MessagingOutputPort } from '../application/ports/output/messaging.port';
import type { OAuthAccessTokenProvider } from '../application/services/OAuthAccessTokenService';

/** Drizzle database handle produced by `drizzle(sql)`. */
export type DrizzleDatabase = ReturnType<typeof drizzle>;

/** Telegram-specific feature bundle created when Telegram is configured. */
export interface TelegramFeature {
  /** Outbound Telegram messaging adapter. */
  adapter: TelegramMessengerAdapter;
  /** Handler for the `/start` command. */
  handleStartCommand: HandleStartCommand;
  /** Sends the immediate "processing" acknowledgement. */
  sendImmediateAcknowledgement: SendImmediateAcknowledgement;
  /** Fallback handler for unsupported message types. */
  handleUnsupportedMessage: HandleUnsupportedMessage;
  /** Rule-based intent classifier for free-text expense messages. */
  classifyFreeTextExpenseIntent: ClassifyFreeTextExpenseIntent;
  /** Sends contextual expense guidance. */
  sendExpenseGuidance: SendExpenseGuidance;
  /** Redis-backed idempotency store for processed messages. */
  processedMessageRepository: RedisProcessedMessageRepository;
  /** Routes an incoming normalized message to the FSM worker queue. */
  routeIncomingMessage: RouteIncomingMessage;
}

/** Google OAuth-dependent feature bundle created when OAuth credentials are configured. */
export interface GoogleOAuthFeature {
  /** OAuth adapter for Google Drive / Sheets authorization flows. */
  adapter: GoogleDriveOAuthAdapter;
  /** Kicks off the Google OAuth consent flow. */
  initiateCloudConnection: InitiateCloudConnection;
  /** Handles the OAuth provider callback and completes token exchange. */
  handleOAuthCallback: HandleOAuthCallback;
  /** Sends periodic reminders to users who have not completed OAuth. */
  sendOAuthReminder: SendOAuthReminder;
  /** Cancels an in-flight OAuth connection attempt. */
  cancelCloudConnection: CancelCloudConnection;
  /** Lists Google Drive spreadsheet files for the user. */
  driveFileDiscovery: GoogleDriveFileDiscoveryAdapter;
  /** Factory for creating Google Sheets adapters from an access token. */
  sheetsAdapterFactory: GoogleSheetsAdapterFactory;
  /** Factory for creating spreadsheet readers from an access token. */
  categoryReaderFactory: SpreadsheetCategoryReaderFactory;
  /** Selects a spreadsheet file and advances to sheet selection. */
  handleSpreadsheetFileSelection: HandleSpreadsheetFileSelection;
  /** Selects a sheet within a spreadsheet and advances to validation. */
  handleSheetSelection: HandleSheetSelection;
  /** Validates read/write access to the selected spreadsheet. */
  validateSpreadsheetAccess: ValidateSpreadsheetAccess;
  /** Restarts access validation and mapping inference for the active sheet. */
  startSpreadsheetReconfiguration: StartSpreadsheetReconfigurationUseCase;
  /** Infers column mappings from the sheet headers. */
  inferColumnMapping: InferColumnMapping;
  /** Persists a confirmed column mapping. */
  confirmColumnMapping: ConfirmColumnMapping;
  /** Applies user corrections to a proposed column mapping. */
  correctColumnMapping: CorrectColumnMapping;
  /** Detects existing categories in the spreadsheet. */
  detectCategories: DetectCategories;
  /** Confirms the detected category list. */
  confirmCategories: ConfirmCategories;
  /** Applies add, remove, and rename commands to the category vocabulary. */
  modifyCategoryVocabulary: ModifyCategoryVocabulary;
}

/** Structured dependency graph assembled at bootstrap time. */
export interface Dependencies {
  /** Drizzle ORM database handle. */
  db: DrizzleDatabase;
  /** Redis connection used by BullMQ and repositories. */
  redis: Redis;
  /** Root Pino logger for the process. */
  rootLogger: Logger;

  // Repositories
  userRepo: DrizzleUserRepository;
  conversationRepo: DrizzleConversationStateRepository;
  operationLogRepo: DrizzleOperationLogRepository;
  tokenRepo: DrizzleOAuthTokenRepository;
  spreadsheetConfigRepo: DrizzleSpreadsheetConfigRepository;
  columnMappingRepo: DrizzleColumnMappingRepository;
  categoryVocabularyRepo: DrizzleCategoryVocabularyRepository;
  userCategoryRepo: DrizzleUserCategoryRepository;
  expenseRecordRepo: DrizzleExpenseRecordRepository;
  expenseQueueRepo: DrizzleExpenseQueueRepository;

  // Security
  tokenEncryption: TokenEncryptionAdapter;
  oauthAccessTokenService: OAuthAccessTokenProvider;

  // Conversation use cases (always created when DB/Redis are present)
  resolveIdentity: ResolveUserIdentityUseCase;
  getConversationState: GetConversationState;
  transitionState: TransitionConversationState;
  recoverCorruptedState: RecoverCorruptedState;

  // Queues
  messageQueue: Queue<ProcessMessageJobData>;
  incomingMessageQueue: Queue<IncomingMessageJobData>;
  reminderQueue: Queue;

  // LLM adapters (always created; at least one API key is required)
  llmPort: LLMPort;
  llmHeaderDetectionAdapter: LLMHeaderDetectionAdapter;
  llmColumnInferenceAdapter: LLMColumnInferenceAdapter;

  // Spreadsheet helpers (always created)
  spreadsheetAccessAdapterFactory: SpreadsheetAccessAdapterFactory;
  ruleBasedColumnInferenceAdapter: RuleBasedColumnInferenceAdapter;
  ruleBasedHeaderDetectionAdapter: RuleBasedHeaderDetectionAdapter;

  // Redis-backed helpers
  mappingCorrectionStateRepository: RedisMappingCorrectionStateRepository;
  userProcessingLock: RedisUserProcessingLock;

  // Expense registration use cases
  registerExpense: RegisterExpenseUseCase;
  queuePendingExpense: QueuePendingExpense;
  advancePendingExpense: AdvancePendingExpense;
  correctExpense: CorrectExpenseUseCase;
  generateExpenseSummary: GenerateExpenseSummaryUseCase;
  resolveExpenseSummaryAction: ResolveExpenseSummaryActionUseCase;
  cancelExpenseRegistration: CancelExpenseRegistrationUseCase;
  resolveExpenseReviewReply: ResolveExpenseReviewReplyUseCase;
  undoLastExpense?: UndoLastExpenseUseCase;
  retryExpenseSave: RetryExpenseSaveUseCase;
  expenseSummaryPresenterFactory: (
    messaging: MessagingOutputPort,
    chatId: string,
  ) => ExpenseSummaryPresenter;

  /** Optional Telegram feature bundle. */
  telegram: TelegramFeature | null;
  /** Optional Google OAuth feature bundle. */
  googleOAuth: GoogleOAuthFeature | null;
}

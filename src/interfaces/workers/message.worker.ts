// LAYER: Interfaces
// BullMQ worker — Stage 2 of the async pipeline (ADR-005).
// Consumes `process-message` jobs in the same persistent process as Fastify.
// Responsibilities: FSM → NLP → user response.

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { RegisterExpenseUseCase } from '../../application/use-cases/expense/RegisterExpense';
import type { CorrectExpenseUseCase } from '../../application/use-cases/expense/CorrectExpenseUseCase';
import type { GenerateExpenseSummaryUseCase } from '../../application/use-cases/expense/GenerateExpenseSummaryUseCase';
import type { ResolveExpenseSummaryActionUseCase } from '../../application/use-cases/expense/ResolveExpenseSummaryActionUseCase';
import type { CancelExpenseRegistrationUseCase } from '../../application/use-cases/expense/CancelExpenseRegistrationUseCase';
import type { UndoLastExpenseUseCase } from '../../application/use-cases/expense/UndoLastExpense';
import type { RetryExpenseSaveUseCase } from '../../application/use-cases/expense/RetryExpenseSaveUseCase';
import type { QueuePendingExpense } from '../../application/use-cases/expense/QueuePendingExpense';
import type { ClassifyFreeTextExpenseIntent } from '../../application/use-cases/conversation/ClassifyFreeTextExpenseIntent';
import type {
  ResolveExpenseReviewReplyOutcome,
  ResolveExpenseReviewReplyUseCase,
} from '../../application/use-cases/expense/ResolveExpenseReviewReplyUseCase';
import type { TransitionConversationState } from '../../application/use-cases/conversation/TransitionConversationState';
import type { IUserProfilePort } from '../../domain/ports/IUserProfilePort';
import type { RecoverCorruptedState } from '../../application/use-cases/conversation/RecoverCorruptedState';
import type { GetConversationState } from '../../application/use-cases/conversation/GetConversationState';
import type { IUserProcessingLock } from '../../application/ports/UserProcessingLock';
import type { ConversationState } from '../../domain/entities/ConversationState';
import type { MessagingOutputPort } from '../../application/ports/output/messaging.port';
import type { ExpenseSummaryPresenter } from '../../application/ports/output/expense-summary.presenter';
import {
  ProcessMessageJobDataSchema,
  type ProcessMessageJobData,
} from '../../application/ports/ProcessMessageJob';
import { InvalidJobPayloadError } from '../../application/ports/InvalidJobPayloadError';
import { BULLMQ_WORKER_DRAIN_DELAY_SECONDS, registerBullMqErrorListener } from './bullMqRuntime';
import type { ExpenseReviewPayload } from '../../domain/value-objects/expense-review-payload';
import type {
  IUserRepository,
  IMappingCorrectionStateRepository,
  IExpenseRecordRepository,
} from '../../domain/ports/repositories';
import { ColumnMappingCorrectionState } from '../../domain/value-objects/ColumnMappingCorrectionState';
import type { ColumnMapping } from '../../domain/entities/SpreadsheetConfig';
import type { MappingCorrection } from '../../domain/value-objects/ColumnMappingCorrectionState';
import type { InitiateCloudConnection } from '../../application/use-cases/spreadsheet/InitiateCloudConnection';
import type { CancelCloudConnection } from '../../application/use-cases/spreadsheet/CancelCloudConnection';
import type { HandleSpreadsheetFileSelection } from '../../application/use-cases/spreadsheet/HandleSpreadsheetFileSelection';
import type { HandleSheetSelection } from '../../application/use-cases/spreadsheet/HandleSheetSelection';
import type { ValidateSpreadsheetAccess } from '../../application/use-cases/spreadsheet/ValidateSpreadsheetAccess';
import type { InferColumnMapping } from '../../application/use-cases/spreadsheet/InferColumnMapping';
import type { ConfirmColumnMapping } from '../../application/use-cases/spreadsheet/ConfirmColumnMapping';
import type { CorrectColumnMapping } from '../../application/use-cases/spreadsheet/CorrectColumnMapping';
import type { DetectCategories } from '../../application/use-cases/spreadsheet/DetectCategories';
import type { ConfirmCategories } from '../../application/use-cases/spreadsheet/ConfirmCategories';
import type { ModifyCategoryVocabulary } from '../../application/use-cases/spreadsheet/ModifyCategoryVocabulary';
import type { StartSpreadsheetReconfigurationUseCase } from '../../application/use-cases/spreadsheet/StartSpreadsheetReconfigurationUseCase';
import { UserAlreadyProcessingError } from '../../domain/errors/UserAlreadyProcessingError';
import { onboardingCopies } from '../../application/copies/onboarding.copies';
import { expenseCopies } from '../../application/copies/expense.copies';
import {
  isConfirmIntent,
  isCancelIntent,
  isListColumnsIntent,
  isIdkVariant,
} from '../../application/utils/intents';
import {
  isNewExpenseDuringClarification,
  buildCurrencyOptions,
  formatCurrencyOption,
} from '../../application/utils/clarification';
import { ExpenseClarificationState } from '../../domain/value-objects/expense-clarification-state';
import { ExpenseCorrectionState } from '../../domain/value-objects/expense-correction-state';
import { isExpenseSaveRetryPayload } from '../../domain/value-objects/expense-save-retry-payload';
import { isExpenseLikeIntent } from '../../domain/value-objects/FreeTextIntent';

// Lock TTL must exceed the longest possible job duration (LLM + side effects).
// The worker's lockDuration is 2 min, so 3 min provides a generous safety margin
// without renewal complexity.
const USER_LOCK_TTL_MS = 180_000;
const UNDO_CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

export interface MessageWorkerDeps {
  redis: Redis;
  logger: Logger;
  userProcessingLock: IUserProcessingLock;
  registerExpense: RegisterExpenseUseCase | null;
  queuePendingExpense: QueuePendingExpense;
  classifyFreeTextExpenseIntent: ClassifyFreeTextExpenseIntent;
  correctExpense: CorrectExpenseUseCase | null;
  generateExpenseSummary: GenerateExpenseSummaryUseCase | null;
  resolveExpenseSummaryAction: ResolveExpenseSummaryActionUseCase | null;
  cancelExpenseRegistration: CancelExpenseRegistrationUseCase;
  resolveExpenseReviewReply: ResolveExpenseReviewReplyUseCase | null;
  retryExpenseSave?: RetryExpenseSaveUseCase | null;
  undoLastExpense?: UndoLastExpenseUseCase | null | undefined;
  getConversationState: GetConversationState;
  transitionState: TransitionConversationState;
  expenseSummaryPresenterFactory?: (
    messaging: MessagingOutputPort,
    chatId: string,
  ) => ExpenseSummaryPresenter;
  recoverCorruptedState: RecoverCorruptedState;
  userRepo: IUserRepository;
  messagingAdapters: Record<'telegram' | 'whatsapp', MessagingOutputPort>;
  userProfilePort?: IUserProfilePort | null;
  expenseRecordRepo?: IExpenseRecordRepository | null;
  mappingCorrectionStateRepository?: IMappingCorrectionStateRepository | null;
  initiateCloudConnection?: InitiateCloudConnection | null;
  cancelCloudConnection?: CancelCloudConnection | null;
  handleSpreadsheetFileSelection?: HandleSpreadsheetFileSelection | null;
  handleSheetSelection?: HandleSheetSelection | null;
  validateSpreadsheetAccess?: ValidateSpreadsheetAccess | null;
  inferColumnMapping?: InferColumnMapping | null;
  confirmColumnMapping?: ConfirmColumnMapping | null;
  correctColumnMapping?: CorrectColumnMapping | null;
  detectCategories?: DetectCategories | null;
  confirmCategories?: ConfirmCategories | null;
  modifyCategoryVocabulary?: ModifyCategoryVocabulary | null;
  startSpreadsheetReconfiguration?: StartSpreadsheetReconfigurationUseCase | null;
}

export async function processMessageJob(
  job: Job<ProcessMessageJobData>,
  opts: MessageWorkerDeps,
): Promise<void> {
  const parsed = ProcessMessageJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new InvalidJobPayloadError(
      'process-message',
      parsed.error.issues.map((issue) => issue.path.join('.')),
    );
  }
  const data = parsed.data;
  const { userId, channel, externalId } = data;

  const identity = await opts.userRepo.findByMessagingIdentity(channel, externalId);
  if (identity?.userId !== userId) {
    throw new Error('Messaging identity does not match job user');
  }

  // Acquire per-user lock to serialize processing of concurrent
  // messages from the same user (ADR-011 gap). Must happen before
  // any side effect (FSM read, LLM call, send) so BullMQ retry
  // does not duplicate user-facing messages.
  const lockToken = await opts.userProcessingLock.acquire(userId, USER_LOCK_TTL_MS);
  if (!lockToken) {
    throw new UserAlreadyProcessingError(userId);
  }

  try {
    const messaging = opts.messagingAdapters[channel];

    const conversationState = await opts.getConversationState.execute({ userId });
    const currentState = conversationState?.currentState ?? 'IDLE';

    // Route according to FSM state. Known business errors are already turned
    // into user-facing messages by each use case; this try/catch only catches
    // unexpected throws so BullMQ does not retry side-effectful handlers and
    // re-send the same messages on every attempt (ADR-005).
    try {
      await routeByState(currentState, data, conversationState, opts, messaging);
    } catch (err) {
      opts.logger.error({
        msg: 'process-message handler threw unexpectedly',
        endpoint: 'processMessageJob',
        code: 'UNEXPECTED_HANDLER_ERROR',
        userId,
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        await messaging.sendMessage(externalId, expenseCopies.fallbackError());
      } catch (sendErr) {
        opts.logger.error({
          msg: 'Failed to send fallback error after handler failure',
          endpoint: 'processMessageJob',
          code: 'FALLBACK_SEND_FAILED',
          userId,
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
      }
    }
  } finally {
    try {
      await opts.userProcessingLock.release(userId, lockToken);
    } catch (releaseErr) {
      opts.logger.error({
        msg: 'Failed to release per-user processing lock',
        endpoint: 'processMessageJob',
        code: 'LOCK_RELEASE_FAILED',
        userId,
        error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
      });
    }
  }
}

async function routeByState(
  currentState: string,
  jobData: ProcessMessageJobData,
  conversationState: ConversationState | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  const { userId, rawMessage, channel, externalId } = jobData;

  // The immediate-undo token is valid for precisely the next inbound message.
  // Clear it before any other routing path, including global cancellation.
  const isImmediateUndoCommand = currentState === 'IDLE' && isUndoCommand(rawMessage);
  if (
    currentState === 'IDLE' &&
    conversationState?.statePayload?.immediateUndoExpenseId &&
    !isImmediateUndoCommand
  ) {
    await opts.transitionState.execute({ userId, targetState: 'IDLE', payload: null });
  }

  const cancellationSource =
    jobData.callbackData?.action === 'cancel'
      ? 'callback'
      : isCancelIntent(rawMessage)
        ? 'text'
        : null;
  if (
    currentState === 'EXPENSE_REVIEW' &&
    isUndoCommand(rawMessage) &&
    typeof conversationState?.statePayload?.immediateUndoExpenseId === 'string' &&
    opts.undoLastExpense &&
    isValidExpenseReviewPayload(conversationState.statePayload)
  ) {
    const reviewPayload = { ...conversationState.statePayload };
    delete reviewPayload.immediateUndoExpenseId;
    await opts.transitionState.execute({
      userId,
      targetState: 'EXPENSE_REVIEW',
      payload: reviewPayload,
      expiresAt: conversationState.expiresAt,
    });
    try {
      const result = await opts.undoLastExpense.execute({
        userId,
        action: 'request',
        immediateEligible: true,
      });
      await sendUndoOutcome(result, messaging, externalId);
    } catch (err) {
      opts.logger.error({
        msg: 'Failed to undo while preserving queued review',
        endpoint: 'routeByState',
        code: 'QUEUE_UNDO_FAILED',
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      await messaging.sendMessage(externalId, expenseCopies.undoDeletionFailed());
    }
    await presentExpenseSummary(
      userId,
      reviewPayload as unknown as ExpenseReviewPayload,
      messaging,
      externalId,
      opts,
    );
    return;
  }
  // Review replies retain their existing resolver so text and inline actions
  // share the cancellation use case there. Every other state is cancelled
  // before it can invoke NLP, mutate state, or write an expense.
  const supportsExpenseCancellation =
    currentState === 'IDLE' ||
    currentState === 'EXPENSE_RECEIVING' ||
    currentState === 'EXPENSE_CLARIFYING' ||
    currentState === 'EXPENSE_CORRECTING';
  if (cancellationSource !== null && supportsExpenseCancellation) {
    await opts.cancelExpenseRegistration.execute({
      userId,
      chatId: externalId,
      currentState,
      source: cancellationSource,
      channel,
    });
    return;
  }

  if (
    jobData.callbackData === undefined &&
    shouldQueueAdditionalExpense(
      currentState,
      conversationState?.statePayload ?? null,
      rawMessage,
      opts.classifyFreeTextExpenseIntent,
    )
  ) {
    const outcome = await opts.queuePendingExpense.execute({ userId, rawMessage, channel });
    if (outcome.status === 'full') {
      await messaging.sendMessage(externalId, expenseCopies.expenseQueueFull());
    }
    return;
  }

  switch (currentState) {
    case 'IDLE':
    case 'EXPENSE_RECEIVING': {
      if (currentState === 'IDLE' && isUndoCommand(rawMessage) && opts.undoLastExpense) {
        const immediateUndoExpenseId = conversationState?.statePayload?.immediateUndoExpenseId;
        const result = await opts.undoLastExpense.execute({
          userId,
          action: 'request',
          immediateEligible: typeof immediateUndoExpenseId === 'string',
        });
        if (result.status === 'confirmation_required' && result.expense) {
          await opts.transitionState.execute({
            userId,
            targetState: 'EXPENSE_UNDO_CONFIRMING',
            payload: { pendingExpenseId: result.expense.id },
            expiresAt: new Date(Date.now() + UNDO_CONFIRMATION_TIMEOUT_MS),
          });
          await messaging.sendMessage(
            externalId,
            expenseCopies.undoConfirmationRequired(
              result.expense.concepto,
              result.expense.monto,
              result.expense.moneda,
              result.expense.savedAt,
            ),
          );
        } else {
          await sendUndoOutcome(result, messaging, externalId);
        }
        break;
      }
      if (!opts.registerExpense) {
        await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
        break;
      }

      // Start expense interpretation
      const result = await opts.registerExpense.interpret({
        userId,
        rawMessage,
        channel,
      });

      if (result.status === 'needs_clarification') {
        const question =
          result.missingField === 'monto'
            ? expenseCopies.clarificationAmount()
            : expenseCopies.clarificationCurrency();
        await messaging.sendMessage(externalId, question);
      } else if (result.status === 'needs_zero_confirmation') {
        // Zero-amount confirmation path: state already transitioned by use case
        await messaging.sendMessage(externalId, expenseCopies.zeroAmountConfirmation());
      } else {
        // Format and send summary for review (E1-US-06)
        await presentExpenseSummary(userId, result.payload, messaging, externalId, opts);
      }
      break;
    }

    case 'EXPENSE_REVIEW': {
      // User is confirming, correcting or canceling
      await handleExpenseReview(jobData, conversationState?.statePayload ?? null, opts, messaging);
      break;
    }

    case 'EXPENSE_SAVING_RETRY': {
      await handleExpenseSavingRetry(
        jobData,
        conversationState?.statePayload ?? null,
        conversationState?.expiresAt ?? null,
        opts,
        messaging,
      );
      break;
    }

    case 'EXPENSE_CORRECTING': {
      await handleExpenseCorrection(
        jobData,
        conversationState?.statePayload ?? null,
        opts,
        messaging,
      );
      break;
    }

    case 'EXPENSE_CLARIFYING': {
      // User is responding to a clarification question
      await handleClarification(jobData, conversationState?.statePayload ?? null, opts, messaging);
      break;
    }

    case 'EXPENSE_UNDO_CONFIRMING': {
      const pendingExpenseId = conversationState?.statePayload?.pendingExpenseId;
      if (typeof pendingExpenseId !== 'string' || !opts.undoLastExpense) {
        await opts.transitionState.execute({ userId, targetState: 'IDLE' });
        await messaging.sendMessage(externalId, expenseCopies.undoNotFound());
        break;
      }

      if (isCancelIntent(rawMessage)) {
        await opts.transitionState.execute({ userId, targetState: 'IDLE' });
        await messaging.sendMessage(externalId, expenseCopies.undoCancelled());
        break;
      }

      if (!isConfirmIntent(rawMessage)) {
        await messaging.sendMessage(externalId, expenseCopies.ambiguousResponse());
        break;
      }

      const result = await opts.undoLastExpense.execute({
        userId,
        action: 'confirm',
        immediateEligible: false,
        pendingExpenseId,
      });
      await opts.transitionState.execute({ userId, targetState: 'IDLE' });
      await sendUndoOutcome(result, messaging, externalId);
      break;
    }

    case 'ONBOARDING_START': {
      const promptShown = conversationState?.statePayload?.promptShown === true;

      if (!promptShown) {
        await messaging.sendMessage(externalId, onboardingCopies.welcomePrompt());
        await opts.transitionState.execute({
          userId,
          targetState: 'ONBOARDING_START',
          payload: { promptShown: true },
        });
        break;
      }

      if (opts.initiateCloudConnection) {
        await opts.initiateCloudConnection.execute({ userId, rawMessage, externalId, channel });
      } else {
        await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
      }
      break;
    }

    case 'ONBOARDING_DRIVE': {
      if (!opts.cancelCloudConnection) {
        await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
        break;
      }
      const lower = rawMessage.toLowerCase().trim();
      if (lower === 'cancelar') {
        const state = conversationState?.statePayload?.state;
        if (typeof state === 'string') {
          await opts.cancelCloudConnection.execute({ userId, state, externalId, channel });
        } else {
          await opts.transitionState.execute({ userId, targetState: 'IDLE' });
          await messaging.sendMessage(externalId, onboardingCopies.cancelledMessage());
        }
      } else {
        await messaging.sendMessage(externalId, onboardingCopies.waitForAuthPrompt());
      }
      break;
    }

    case 'ONBOARDING_FILE': {
      if (opts.handleSpreadsheetFileSelection) {
        await opts.handleSpreadsheetFileSelection.execute({
          userId,
          rawMessage,
          externalId,
          channel,
          statePayload: conversationState?.statePayload ?? null,
        });
      } else {
        await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
      }
      break;
    }

    case 'ONBOARDING_SHEET': {
      if (opts.handleSheetSelection) {
        await opts.handleSheetSelection.execute({
          userId,
          rawMessage,
          externalId,
          channel,
          statePayload: conversationState?.statePayload ?? null,
        });
      } else {
        await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
      }
      break;
    }

    case 'ONBOARDING_VALIDATING_ACCESS': {
      if (opts.validateSpreadsheetAccess) {
        await opts.validateSpreadsheetAccess.execute({
          userId,
          externalId,
          channel,
          statePayload: conversationState?.statePayload ?? null,
        });
      } else {
        await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
      }
      break;
    }

    case 'ONBOARDING_MAPPING': {
      await handleOnboardingMapping(
        jobData,
        conversationState?.statePayload ?? null,
        opts,
        messaging,
      );
      break;
    }

    case 'ONBOARDING_CATEGORIES': {
      const categoryPayload = conversationState?.statePayload ?? null;
      const hasCategories =
        Array.isArray(categoryPayload?.categories) &&
        (categoryPayload.categories as string[]).length > 0;

      if (!hasCategories) {
        if (opts.detectCategories) {
          await opts.detectCategories.execute({
            userId,
            externalId,
            channel,
            statePayload: categoryPayload,
          });
        } else {
          await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
        }
      } else if (isConfirmIntent(rawMessage)) {
        if (opts.confirmCategories) {
          await opts.confirmCategories.execute({
            userId,
            externalId,
            channel,
            statePayload: categoryPayload,
          });
        } else {
          await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
        }
      } else {
        if (opts.modifyCategoryVocabulary) {
          await opts.modifyCategoryVocabulary.execute({
            userId,
            externalId,
            channel,
            rawMessage,
            statePayload: categoryPayload,
          });
        } else {
          // Re-send the confirmation prompt for any non-confirm reply.
          await messaging.sendMessage(
            externalId,
            onboardingCopies.categoryConfirmationPrompt(categoryPayload.categories as string[]),
          );
        }
      }
      break;
    }

    default: {
      // Estado no reconocido o válido pero sin handler: reset seguro (ADR-003, HU-0.04 Escenario 4)
      const recovery = await opts.recoverCorruptedState.execute({
        userId,
        observedState: currentState,
      });
      if (recovery.recovered) {
        await messaging.sendMessage(externalId, recovery.message);
      } else {
        // Estado válido pero no manejado: forzar reset a IDLE para no dejar al usuario atascado
        await opts.transitionState.execute({ userId, targetState: 'IDLE' });
        await messaging.sendMessage(externalId, expenseCopies.fallbackError());
      }
    }
  }
}

function isActiveExpenseQueueState(currentState: string): boolean {
  return (
    currentState === 'EXPENSE_REVIEW' ||
    currentState === 'EXPENSE_CLARIFYING' ||
    currentState === 'EXPENSE_CORRECTING'
  );
}

function shouldQueueAdditionalExpense(
  currentState: string,
  statePayload: Record<string, unknown> | null,
  rawMessage: string,
  classifyFreeTextExpenseIntent: ClassifyFreeTextExpenseIntent,
): boolean {
  if (
    !isActiveExpenseQueueState(currentState) ||
    !isExpenseLikeIntent(classifyFreeTextExpenseIntent.execute(rawMessage))
  ) {
    return false;
  }

  if (currentState === 'EXPENSE_CLARIFYING') {
    try {
      return isNewExpenseDuringClarification(
        rawMessage,
        ExpenseClarificationState.fromPayload(statePayload).missingField,
      );
    } catch {
      return false;
    }
  }

  return !isLikelyExpenseCorrection(rawMessage);
}

function isLikelyExpenseCorrection(rawMessage: string): boolean {
  return /^(?:no\b|correg|fueron\b|pon(?:elo|lo)\b|cambi)/i.test(rawMessage.trim());
}

async function handleExpenseSavingRetry(
  jobData: ProcessMessageJobData,
  statePayload: Record<string, unknown> | null,
  expiresAt: Date | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  const { userId, rawMessage, externalId, channel } = jobData;
  if (
    !isExpenseSaveRetryPayload(statePayload) ||
    expiresAt === null ||
    expiresAt.getTime() <= Date.now()
  ) {
    await opts.transitionState.execute({ userId, targetState: 'IDLE', payload: null });
    await messaging.sendMessage(externalId, expenseCopies.saveRetryExpired());
    return;
  }

  const command = rawMessage.toLocaleLowerCase('es-AR').trim();
  if (command === 'reintentar') {
    if (!opts.retryExpenseSave) {
      await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
      return;
    }
    await opts.retryExpenseSave.execute({
      userId,
      chatId: externalId,
      statePayload,
      expiresAt,
    });
    return;
  }

  if (command === 'reconfigurar') {
    if (!opts.startSpreadsheetReconfiguration) {
      await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
      return;
    }
    await opts.startSpreadsheetReconfiguration.execute({ userId, chatId: externalId, channel });
    return;
  }

  await messaging.sendMessage(externalId, expenseCopies.saveNetworkFailure());
}

function isUndoCommand(rawMessage: string): boolean {
  const normalized = rawMessage
    .trim()
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalized === 'deshacer' || normalized === 'undo' || normalized === 'borrar el ultimo';
}

async function sendUndoOutcome(
  result: Awaited<ReturnType<UndoLastExpenseUseCase['execute']>>,
  messaging: MessagingOutputPort,
  chatId: string,
): Promise<void> {
  switch (result.status) {
    case 'deleted':
      if (result.expense) {
        await messaging.sendMessage(
          chatId,
          expenseCopies.undoDeleted(
            result.expense.concepto,
            result.expense.monto,
            result.expense.moneda,
          ),
        );
      }
      return;
    case 'not_found':
      await messaging.sendMessage(chatId, expenseCopies.undoNotFound());
      return;
    case 'deletion_failed':
      await messaging.sendMessage(chatId, expenseCopies.undoDeletionFailed());
      return;
    case 'confirmation_required':
      await messaging.sendMessage(chatId, expenseCopies.undoNotFound());
  }
}

export function createMessageWorker(opts: MessageWorkerDeps): Worker<ProcessMessageJobData> {
  const worker = new Worker<ProcessMessageJobData>(
    'process-message',
    async (job: Job<ProcessMessageJobData>) => processMessageJob(job, opts),
    {
      connection: opts.redis,
      concurrency: 2, // max 2 simultaneous jobs to not saturate LLM API (ADR-005)
      drainDelay: BULLMQ_WORKER_DRAIN_DELAY_SECONDS,
      stalledInterval: 120_000, // 2 min (default 30s) — reduce Redis evalsha calls
      lockDuration: 120_000, // 2 min (default 30s) — LLM jobs can run >30s
      lockRenewTime: 60_000, // 1 min (default 15s) — fewer lock renewals
      settings: {
        // Custom backoff: retry only lock contention; return -1 for all other
        // errors so side-effectful handlers are not retried (see ADR-015).
        backoffStrategy: (attemptsMade: number, _type: string | undefined, err?: Error) => {
          if (err?.name === 'UserAlreadyProcessingError') {
            // Exponential: 500ms, 1s, 2s, 4s, capped at 5s
            return Math.min(500 * Math.pow(2, attemptsMade - 1), 5000);
          }
          return -1; // do not retry
        },
      },
    },
  );

  registerBullMqErrorListener(worker, {
    logger: opts.logger,
    queue: 'process-message',
    resourceKind: 'worker',
  });

  // Dead letter: jobs que agotan reintentos → log estructurado (ADR-005)
  worker.on('failed', (job, err) => {
    opts.logger.error({
      msg: 'Job failed permanently',
      jobId: job?.id,
      queue: 'process-message',
      code: err instanceof InvalidJobPayloadError ? err.code : 'JOB_FAILED',
      ...(err instanceof InvalidJobPayloadError ? { validationPaths: err.paths } : {}),
      error: err.message,
    });
  });

  return worker;
}

// ── Helpers de formato ────────────────────────────────────────────────────────

async function presentExpenseSummary(
  userId: string,
  payload: ExpenseReviewPayload,
  messaging: MessagingOutputPort,
  externalId: string,
  opts: MessageWorkerDeps,
): Promise<void> {
  if (!opts.generateExpenseSummary || !opts.expenseSummaryPresenterFactory) {
    await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
    return;
  }

  const presenter = opts.expenseSummaryPresenterFactory(messaging, externalId);
  await opts.generateExpenseSummary.execute({ userId, payload, presenter });
}

async function handleOnboardingMapping(
  jobData: ProcessMessageJobData,
  statePayload: Record<string, unknown> | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  const { userId, rawMessage, channel, externalId } = jobData;
  const isResuming = statePayload?.step === 'resume';
  const isNoHeader = statePayload?.step === 'no-header';
  const hasProposal = Array.isArray(statePayload?.mappings);

  if (isResuming) {
    await handleResumeResponse(
      userId,
      rawMessage,
      externalId,
      channel,
      statePayload,
      opts,
      messaging,
    );
    return;
  }

  if (hasProposal) {
    await handleMappingConfirmation(
      userId,
      rawMessage,
      externalId,
      channel,
      statePayload,
      opts,
      messaging,
    );
    return;
  }

  if (isNoHeader) {
    await handleNoHeaderResponse(userId, rawMessage, externalId, channel, statePayload, opts);
    return;
  }

  // No proposal in the FSM payload: check for a saved correction snapshot.
  const repo = opts.mappingCorrectionStateRepository;
  if (repo) {
    const snapshot = await repo.load(userId);
    if (snapshot) {
      const currentMappings = restoreCorrectionSnapshot(snapshot).getCurrentMapping();
      const prompt = onboardingCopies.mappingResumePrompt(currentMappings.map(toDisplayMapping));
      await messaging.sendMessage(externalId, prompt);
      await opts.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_MAPPING',
        payload: { ...statePayload, step: 'resume' },
      });
      return;
    }
  }

  if (opts.inferColumnMapping) {
    await opts.inferColumnMapping.execute({
      userId,
      externalId,
      channel,
      statePayload,
    });
  } else {
    await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
  }
}

async function handleNoHeaderResponse(
  userId: string,
  rawMessage: string,
  externalId: string,
  channel: 'telegram' | 'whatsapp',
  statePayload: Record<string, unknown> | null,
  opts: MessageWorkerDeps,
): Promise<void> {
  const trimmed = rawMessage.trim();
  const dataStartRow = Number(trimmed);

  if (trimmed === '' || !Number.isInteger(dataStartRow) || dataStartRow < 2) {
    await opts.messagingAdapters[channel].sendMessage(
      externalId,
      onboardingCopies.invalidDataStartRowPrompt(),
    );
    await opts.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_MAPPING',
      payload: { ...statePayload, step: 'no-header' },
    });
    return;
  }

  const headerRowIndex = dataStartRow - 1;
  const preview = statePayload?.preview as { rows?: Array<{ index: number }> } | undefined;
  const rows = preview?.rows;
  const headerRowExists = Array.isArray(rows) && rows.some((row) => row.index === headerRowIndex);

  if (!headerRowExists) {
    await opts.messagingAdapters[channel].sendMessage(
      externalId,
      onboardingCopies.invalidDataStartRowPrompt(),
    );
    await opts.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_MAPPING',
      payload: { ...statePayload, step: 'no-header' },
    });
    return;
  }

  if (opts.inferColumnMapping) {
    await opts.inferColumnMapping.execute({
      userId,
      externalId,
      channel,
      statePayload: { ...statePayload, headerRowIndex },
    });
  } else {
    await opts.messagingAdapters[channel].sendMessage(
      externalId,
      onboardingCopies.onboardingPlaceholder(),
    );
  }
}

async function handleResumeResponse(
  userId: string,
  rawMessage: string,
  externalId: string,
  channel: 'telegram' | 'whatsapp',
  statePayload: Record<string, unknown> | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  const repo = opts.mappingCorrectionStateRepository;

  if (isCancelIntent(rawMessage)) {
    if (repo) {
      await repo.clear(userId);
    }

    if (opts.inferColumnMapping) {
      await opts.inferColumnMapping.execute({
        userId,
        externalId,
        channel,
        statePayload,
      });
    } else {
      await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
    }
    return;
  }

  if (!isConfirmIntent(rawMessage)) {
    await messaging.sendMessage(externalId, onboardingCopies.mappingResumePrompt([]));
    return;
  }

  if (!repo) {
    await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
    return;
  }

  const snapshot = await repo.load(userId);
  if (!snapshot) {
    // Snapshot expired while the prompt was shown: fall back to inference.
    if (opts.inferColumnMapping) {
      await opts.inferColumnMapping.execute({
        userId,
        externalId,
        channel,
        statePayload,
      });
    } else {
      await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
    }
    return;
  }

  const currentMappings = restoreCorrectionSnapshot(snapshot).getCurrentMapping();
  const message = onboardingCopies.mappingUpdatedConfirmation(
    currentMappings.map(toDisplayMapping),
    [],
  );
  await messaging.sendMessage(externalId, message);
  await opts.transitionState.execute({
    userId,
    targetState: 'ONBOARDING_MAPPING',
    payload: {
      ...statePayload,
      mappings: currentMappings.map(toDisplayMapping),
      unmappedFields: [],
    },
  });
}

async function handleMappingConfirmation(
  userId: string,
  rawMessage: string,
  externalId: string,
  channel: 'telegram' | 'whatsapp',
  statePayload: Record<string, unknown> | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  if (isConfirmIntent(rawMessage)) {
    if (opts.confirmColumnMapping) {
      await opts.confirmColumnMapping.execute({
        userId,
        externalId,
        channel,
        statePayload,
      });
    } else {
      await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
    }
  } else if (isListColumnsIntent(rawMessage)) {
    if (opts.correctColumnMapping) {
      // Pragmatic Phase-1 shortcut: trigger an invalid-column response so the
      // available columns are listed without adding a dedicated query use case.
      await opts.correctColumnMapping.execute({
        userId,
        externalId,
        channel,
        rawMessage: 'la categoría está en la columna ZZZ',
        statePayload,
      });
    } else {
      await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
    }
  } else if (opts.correctColumnMapping) {
    await opts.correctColumnMapping.execute({
      userId,
      externalId,
      channel,
      rawMessage,
      statePayload,
    });
  } else {
    await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
  }
}

function restoreCorrectionSnapshot(snapshot: {
  originalMapping: readonly ColumnMapping[];
  corrections: readonly MappingCorrection[];
}): ColumnMappingCorrectionState {
  let state = ColumnMappingCorrectionState.create(snapshot.originalMapping);
  for (const correction of snapshot.corrections) {
    state = state.applyCorrection(correction);
  }
  return state;
}

function toDisplayMapping(
  mapping: Pick<ColumnMapping, 'GasttoField' | 'columnIndex' | 'columnHeader'>,
) {
  return {
    gasttoField: mapping.GasttoField,
    columnIndex: mapping.columnIndex,
    columnHeader: mapping.columnHeader,
  };
}

async function handleExpenseReview(
  jobData: ProcessMessageJobData,
  statePayload: Record<string, unknown> | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  const { userId, rawMessage, externalId, callbackData } = jobData;

  // Inline-button actions (Phase 3) take precedence over legacy text intents.
  if (callbackData !== undefined) {
    if (!opts.resolveExpenseSummaryAction) {
      await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
      return;
    }

    if (!isValidExpenseReviewPayload(statePayload)) {
      opts.logger.error({
        msg: 'Missing or invalid expense review payload for callback action',
        endpoint: 'handleExpenseReview',
        code: 'INVALID_REVIEW_PAYLOAD',
        userId,
        action: callbackData.action,
      });
      await opts.transitionState.execute({ userId, targetState: 'IDLE' });
      await messaging.sendMessage(externalId, expenseCopies.fallbackError());
      return;
    }

    await opts.resolveExpenseSummaryAction.execute({
      userId,
      action: callbackData.action,
      payload: statePayload as unknown as ExpenseReviewPayload,
      chatId: externalId,
      channel: jobData.channel,
      ...(callbackData.action === 'cancel' ? { cancellationSource: 'callback' as const } : {}),
    });
    return;
  }

  // State payload shape for EXPENSE_REVIEW:
  //   {
  //     extracted: ExtractedExpense,
  //     rawMessage: string,
  //     resolvedDate: string,
  //     resolvedCategory: string | null,
  //     resolvedCategoryId: string | null,
  //     awaitingZeroConfirmation?: boolean, // true when amount is 0 and needs explicit confirmation
  //   }

  if (!opts.resolveExpenseReviewReply || !isValidExpenseReviewPayload(statePayload)) {
    await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
    return;
  }

  const outcome = await opts.resolveExpenseReviewReply.execute({
    userId,
    rawMessage,
    payload: statePayload as unknown as ExpenseReviewPayload,
    chatId: externalId,
    channel: jobData.channel,
  });
  await renderExpenseReviewReplyOutcome(outcome, userId, messaging, externalId, opts);
}

async function handleExpenseCorrection(
  jobData: ProcessMessageJobData,
  statePayload: Record<string, unknown> | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  const { userId, rawMessage, channel, externalId } = jobData;

  if (!opts.correctExpense) {
    await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
    return;
  }

  let correctionState: ExpenseCorrectionState;
  try {
    correctionState = ExpenseCorrectionState.fromPayload(statePayload);
  } catch (err) {
    opts.logger.error({
      msg: 'Missing or invalid expense correction state payload',
      endpoint: 'handleExpenseCorrection',
      code: 'INVALID_CORRECTION_PAYLOAD',
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    await opts.transitionState.execute({ userId, targetState: 'IDLE' });
    await messaging.sendMessage(externalId, expenseCopies.fallbackError());
    return;
  }

  const outcome = await opts.correctExpense.execute({
    userId,
    rawMessage,
    state: correctionState,
    channel,
  });

  await renderExpenseReviewReplyOutcome(outcome, userId, messaging, externalId, opts);
}

async function renderExpenseReviewReplyOutcome(
  outcome: ResolveExpenseReviewReplyOutcome | Awaited<ReturnType<CorrectExpenseUseCase['execute']>>,
  userId: string,
  messaging: MessagingOutputPort,
  externalId: string,
  opts: MessageWorkerDeps,
): Promise<void> {
  switch (outcome.status) {
    case 'action_handled':
      return;
    case 'not_interpretable':
      await messaging.sendMessage(
        externalId,
        'pendingCount' in outcome && outcome.pendingCount > 0
          ? expenseCopies.expenseQueueNonFinancialReminder(outcome.pendingCount)
          : expenseCopies.ambiguousResponse(),
      );
      return;
    case 'cycle_limit':
      await messaging.sendMessage(externalId, expenseCopies.correctionCycleLimitReached());
      return;
    case 'high_amount_confirmation':
    case 'corrected':
      await presentExpenseSummary(userId, outcome.payload, messaging, externalId, opts);
      return;
  }
}

function isValidExpenseReviewPayload(
  statePayload: Record<string, unknown> | null,
): statePayload is Record<string, unknown> & { rawMessage: string; extracted: unknown } {
  if (statePayload === null) {
    return false;
  }

  return typeof statePayload.rawMessage === 'string' && statePayload.extracted !== undefined;
}

async function handleClarification(
  jobData: ProcessMessageJobData,
  statePayload: Record<string, unknown> | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  const { userId, rawMessage, externalId, channel } = jobData;

  if (!opts.registerExpense) {
    await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
    return;
  }

  if (!statePayload) {
    opts.logger.error({
      msg: 'Missing clarification state payload',
      endpoint: 'handleClarification',
      code: 'MISSING_CLARIFICATION_PAYLOAD',
      userId,
    });
    await opts.transitionState.execute({ userId, targetState: 'IDLE' });
    await messaging.sendMessage(externalId, expenseCopies.fallbackError());
    return;
  }

  let state: ExpenseClarificationState;
  try {
    state = ExpenseClarificationState.fromPayload(statePayload);
  } catch (err) {
    opts.logger.error({
      msg: 'Invalid clarification state payload',
      endpoint: 'handleClarification',
      code: 'INVALID_CLARIFICATION_PAYLOAD',
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    await opts.transitionState.execute({ userId, targetState: 'IDLE' });
    await messaging.sendMessage(externalId, expenseCopies.fallbackError());
    return;
  }

  // Interruption: a new expense message cancels the current clarification flow.
  if (isNewExpenseDuringClarification(rawMessage, state.missingField)) {
    await opts.transitionState.execute({ userId, targetState: 'IDLE' });
    await messaging.sendMessage(externalId, expenseCopies.clarificationInterrupted());

    const result = await opts.registerExpense.interpret({
      userId,
      rawMessage,
      channel,
    });

    if (result.status === 'needs_clarification') {
      const question =
        result.missingField === 'monto'
          ? expenseCopies.clarificationAmount()
          : expenseCopies.clarificationCurrency();
      await messaging.sendMessage(externalId, question);
    } else if (result.status === 'needs_zero_confirmation') {
      await messaging.sendMessage(externalId, expenseCopies.zeroAmountConfirmation());
    } else {
      await presentExpenseSummary(userId, result.payload, messaging, externalId, opts);
    }
    return;
  }

  // Invalid answer: reformulate the question with concrete options.
  if (isIdkVariant(rawMessage)) {
    if (state.missingField === 'moneda') {
      const defaultCurrency = opts.userProfilePort
        ? await opts.userProfilePort.getDefaultCurrency(userId)
        : null;
      const recentCurrencies = opts.expenseRecordRepo
        ? await opts.expenseRecordRepo.findRecentCurrenciesByUserId(userId, 5)
        : [];
      const options = buildCurrencyOptions(defaultCurrency, recentCurrencies).map(
        formatCurrencyOption,
      );
      await messaging.sendMessage(externalId, expenseCopies.clarificationReformulation(options));
      return;
    }

    await messaging.sendMessage(externalId, expenseCopies.clarificationAmount());
    return;
  }

  // Retries interpretation with the user's clarification incorporated into the original message.
  const enrichedMessage = `${state.rawMessage} ${rawMessage}`.trim();

  const result = await opts.registerExpense.interpret({
    userId,
    rawMessage: enrichedMessage,
    channel,
    ...(state.queueRegisteredCount === undefined
      ? {}
      : { queueRegisteredCount: state.queueRegisteredCount }),
  });

  if (result.status === 'needs_clarification') {
    const question =
      result.missingField === 'monto'
        ? expenseCopies.clarificationAmount()
        : expenseCopies.clarificationCurrency();
    await messaging.sendMessage(externalId, question);
  } else if (result.status === 'needs_zero_confirmation') {
    await messaging.sendMessage(externalId, expenseCopies.zeroAmountConfirmation());
  } else {
    const summary = expenseCopies.updatedSummary({
      monto: result.payload.extracted.monto,
      moneda: result.payload.extracted.moneda,
      category: result.payload.resolvedCategory ?? '❓ Sin categoría',
      categoryStatus: result.payload.categoryStatus,
      date: result.payload.resolvedDate,
    });
    await messaging.sendMessage(externalId, summary);
  }
}

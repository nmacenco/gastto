// LAYER: Interfaces
// BullMQ worker — Stage 2 of the async pipeline (ADR-005).
// Consumes `process-message` jobs in the same persistent process as Fastify.
// Responsibilities: FSM → NLP → user response.

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { RegisterExpenseUseCase } from '../../application/use-cases/expense/RegisterExpense';
import type { DispatchExpenseSemanticAction } from '../../application/use-cases/expense/DispatchExpenseSemanticAction';
import type { DispatchControlSemanticAction } from '../../application/use-cases/expense/DispatchControlSemanticAction';
import type { PresentUndoConfirmation } from '../../application/use-cases/expense/PresentUndoConfirmation';
import type { CompleteExpenseClarification } from '../../application/use-cases/expense/CompleteExpenseClarification';
import type { CorrectExpenseUseCase } from '../../application/use-cases/expense/CorrectExpenseUseCase';
import type { GenerateExpenseSummaryUseCase } from '../../application/use-cases/expense/GenerateExpenseSummaryUseCase';
import type {
  ResolveExpenseSummaryActionOutcome,
  ResolveExpenseSummaryActionUseCase,
} from '../../application/use-cases/expense/ResolveExpenseSummaryActionUseCase';
import type { CancelExpenseRegistrationUseCase } from '../../application/use-cases/expense/CancelExpenseRegistrationUseCase';
import type { UndoLastExpenseUseCase } from '../../application/use-cases/expense/UndoLastExpense';
import type { RetryExpenseSaveUseCase } from '../../application/use-cases/expense/RetryExpenseSaveUseCase';
import type { QueuePendingExpense } from '../../application/use-cases/expense/QueuePendingExpense';
import type { ClassifyFreeTextExpenseIntent } from '../../application/use-cases/conversation/ClassifyFreeTextExpenseIntent';
import type { SendExpenseGuidance } from '../../application/use-cases/conversation/SendExpenseGuidance';
import type { ObserveSemanticRouting } from '../../application/services/semantic-router/ObserveSemanticRouting';
import type { DeterministicRoutingPolicy } from '../../application/services/semantic-router/deterministic-routing';
import type {
  ResolveExpenseReviewReplyOutcome,
  ResolveExpenseReviewReplyUseCase,
} from '../../application/use-cases/expense/ResolveExpenseReviewReplyUseCase';
import type { TransitionConversationState } from '../../application/use-cases/conversation/TransitionConversationState';
import type { IUserProfilePort } from '../../domain/ports/IUserProfilePort';
import type { RecoverCorruptedState } from '../../application/use-cases/conversation/RecoverCorruptedState';
import type { GetConversationState } from '../../application/use-cases/conversation/GetConversationState';
import type { IUserProcessingLock } from '../../application/ports/UserProcessingLock';
import {
  getFinancialExecutionClaim,
  type ConversationState,
} from '../../domain/entities/ConversationState';
import type { MessagingOutputPort } from '../../application/ports/output/messaging.port';
import type { ExpenseSummaryPresenter } from '../../application/ports/output/expense-summary.presenter';
import {
  ProcessMessageJobDataSchema,
  type ProcessMessageJobData,
} from '../../application/ports/ProcessMessageJob';
import { InvalidJobPayloadError } from '../../application/ports/InvalidJobPayloadError';
import { parseCategoryOnboardingState } from '../../application/dtos/CategoryOnboardingState';
import { BULLMQ_WORKER_DRAIN_DELAY_SECONDS, registerBullMqErrorListener } from './bullMqRuntime';
import {
  tryNormalizeExpenseReviewPayload,
  type ExpenseReviewPayload,
} from '../../domain/value-objects/expense-review-payload';
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
import type { DispatchOptionSelection } from '../../application/use-cases/spreadsheet/DispatchOptionSelection';
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
import { StaleConversationStateError } from '../../domain/errors/StaleConversationStateError';
import { onboardingCopies } from '../../application/copies/onboarding.copies';
import { expenseCopies } from '../../application/copies/expense.copies';
import {
  isConfirmIntent,
  isCancelIntent,
  isUndoIntent,
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
import { parseExpenseSaveRetryPayload } from '../../domain/value-objects/expense-save-retry-payload';
import { parseExpenseUndoPayload } from '../../domain/value-objects/expense-undo-payload';
import { isExpenseLikeIntent } from '../../domain/value-objects/FreeTextIntent';
import { advanceExpenseReviewBinding } from '../../domain/value-objects/expense-review-binding';

// Lock TTL must exceed the longest possible job duration (LLM + side effects).
// The worker's lockDuration is 2 min, so 3 min provides a generous safety margin
// without renewal complexity.
const USER_LOCK_TTL_MS = 180_000;
const USER_LOCK_RENEW_MS = 30_000;

export interface MessageWorkerDeps {
  redis: Redis;
  logger: Logger;
  userProcessingLock: IUserProcessingLock;
  registerExpense: RegisterExpenseUseCase | null;
  queuePendingExpense: QueuePendingExpense;
  classifyFreeTextExpenseIntent: ClassifyFreeTextExpenseIntent;
  deterministicRoutingPolicy: DeterministicRoutingPolicy;
  observeSemanticRouting: ObserveSemanticRouting;
  dispatchExpenseSemanticAction: DispatchExpenseSemanticAction;
  dispatchControlSemanticAction?: DispatchControlSemanticAction | null;
  dispatchOptionSelection?: DispatchOptionSelection | null;
  completeExpenseClarification: CompleteExpenseClarification;
  sendGuidance: SendExpenseGuidance;
  correctExpense: CorrectExpenseUseCase | null;
  generateExpenseSummary: GenerateExpenseSummaryUseCase | null;
  resolveExpenseSummaryAction: ResolveExpenseSummaryActionUseCase | null;
  cancelExpenseRegistration: CancelExpenseRegistrationUseCase;
  resolveExpenseReviewReply: ResolveExpenseReviewReplyUseCase | null;
  retryExpenseSave?: RetryExpenseSaveUseCase | null;
  undoLastExpense?: UndoLastExpenseUseCase | null | undefined;
  presentUndoConfirmation?: PresentUndoConfirmation | null;
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

  let renewalInFlight = false;
  const renewalTimer = setInterval(() => {
    if (renewalInFlight) return;
    renewalInFlight = true;
    void opts.userProcessingLock
      .renew(userId, lockToken, USER_LOCK_TTL_MS)
      .then((renewed) => {
        if (!renewed) {
          opts.transitionState.invalidateExecution(userId);
          opts.logger.error({
            msg: 'Lost per-user processing lock during renewal',
            endpoint: 'processMessageJob',
            code: 'LOCK_RENEW_LOST',
            userId,
          });
        }
      })
      .catch((error: unknown) => {
        opts.transitionState.invalidateExecution(userId);
        opts.logger.error({
          msg: 'Failed to renew per-user processing lock',
          endpoint: 'processMessageJob',
          code: 'LOCK_RENEW_FAILED',
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        renewalInFlight = false;
      });
  }, USER_LOCK_RENEW_MS);
  renewalTimer.unref();

  try {
    const messaging = opts.messagingAdapters[channel];

    const conversationState = await opts.getConversationState.execute({ userId });
    const currentState = conversationState?.currentState ?? 'IDLE';
    const deterministicDecision = opts.deterministicRoutingPolicy.decide({
      state: currentState,
      rawMessage: data.rawMessage,
      hasCallback: data.callbackData !== undefined,
    });

    // Route according to FSM state. Known business errors are already turned
    // into user-facing messages by each use case; this try/catch only catches
    // unexpected throws so BullMQ does not retry side-effectful handlers and
    // re-send the same messages on every attempt (ADR-005).
    try {
      const route = async () => {
        let semanticTurn: Awaited<ReturnType<ObserveSemanticRouting['execute']>> | undefined;
        if (conversationState) {
          try {
            semanticTurn = await opts.observeSemanticRouting.execute({
              userId,
              externalMessageId: data.externalMessageId,
              rawMessage: data.rawMessage,
              conversationState,
              deterministicDecision,
            });
          } catch {
            opts.logger.error({
              msg: 'Semantic shadow observation failed unexpectedly',
              endpoint: 'processMessageJob',
              code: 'SEMANTIC_OBSERVATION_FAILED',
            });
          }
        }
        opts.transitionState.assertExecutionIsValid(userId);
        if (semanticTurn?.status === 'clarification') {
          await messaging.sendMessage(
            externalId,
            conversationState
              ? semanticExpenseGuidance(conversationState, semanticTurn.reason)
              : expenseCopies.semanticExpenseGuidance(
                  semanticTurn.reason === 'ambiguous_reference' ||
                    semanticTurn.reason === 'not_found'
                    ? 'unsupported_action'
                    : semanticTurn.reason,
                ),
          );
          return;
        }
        if (semanticTurn?.status === 'expense_action' && conversationState !== null) {
          let outcome: Awaited<ReturnType<DispatchExpenseSemanticAction['execute']>>;
          try {
            outcome = await opts.dispatchExpenseSemanticAction.execute({
              userId,
              externalId,
              externalMessageId: data.externalMessageId,
              receivedAt: data.receivedAt,
              channel,
              rawMessage: data.rawMessage,
              conversationState,
              expected: semanticTurn.expected,
              decision: semanticTurn.decision,
            });
          } catch (error) {
            opts.observeSemanticRouting.recordExpenseDispatch?.(semanticTurn, {
              status: 'clarification_required',
              reason: 'dispatch_failed',
            });
            throw error;
          }
          opts.observeSemanticRouting.recordExpenseDispatch?.(semanticTurn, outcome);
          opts.transitionState.assertExecutionIsValid(userId);
          if (
            semanticTurn.decision.action === 'register_expense' &&
            conversationState.currentState === 'EXPENSE_CLARIFYING' &&
            outcome.status !== 'clarification_required'
          ) {
            await messaging.sendMessage(externalId, expenseCopies.clarificationInterrupted());
          }
          if (outcome.status === 'missing_data') {
            await messaging.sendMessage(
              externalId,
              outcome.field === 'monto'
                ? expenseCopies.clarificationAmount()
                : expenseCopies.clarificationCurrency(),
            );
          } else if (outcome.status === 'review_required') {
            if (outcome.payload.awaitingZeroConfirmation === true) {
              await presentZeroAmountConfirmation(
                userId,
                outcome.payload,
                messaging,
                externalId,
                opts,
              );
            } else {
              await presentExpenseSummary(userId, outcome.payload, messaging, externalId, opts);
            }
          } else if (outcome.status === 'queue_full') {
            await messaging.sendMessage(externalId, expenseCopies.expenseQueueFull());
          } else if (outcome.status === 'clarification_required') {
            await messaging.sendMessage(
              externalId,
              semanticExpenseGuidance(conversationState, outcome.reason),
            );
          }
          return;
        }
        if (semanticTurn?.status === 'control_action' && conversationState !== null) {
          if (!opts.dispatchControlSemanticAction) {
            opts.observeSemanticRouting.recordControlDispatch?.(semanticTurn, {
              status: 'clarification_required',
              reason: 'unsupported_action',
            });
            await messaging.sendMessage(
              externalId,
              expenseCopies.semanticControlGuidance('unsupported_action'),
            );
            return;
          }
          let outcome: Awaited<ReturnType<DispatchControlSemanticAction['execute']>>;
          try {
            outcome = await opts.dispatchControlSemanticAction.execute({
              userId,
              externalId,
              channel,
              conversationState,
              expected: semanticTurn.expected,
              decision: semanticTurn.decision,
              provenance: semanticTurn.provenance,
            });
          } catch (error) {
            opts.observeSemanticRouting.recordControlDispatch?.(semanticTurn, {
              status: 'clarification_required',
              reason: 'dispatch_failed',
            });
            throw error;
          }
          opts.observeSemanticRouting.recordControlDispatch?.(semanticTurn, outcome);
          opts.transitionState.assertExecutionIsValid(userId);
          if (outcome.status === 'undo_unavailable') {
            await messaging.sendMessage(externalId, expenseCopies.undoNotFound());
          } else if (outcome.status === 'clarification_required') {
            await messaging.sendMessage(
              externalId,
              expenseCopies.semanticControlGuidance(outcome.reason),
            );
          }
          return;
        }
        if (semanticTurn?.status === 'option_selection' && conversationState !== null) {
          if (opts.dispatchOptionSelection === null || opts.dispatchOptionSelection === undefined) {
            opts.observeSemanticRouting.recordOptionDispatch?.(semanticTurn, {
              status: 'clarification_required',
              reason: 'unsupported_action',
            });
            await messaging.sendMessage(
              externalId,
              semanticExpenseGuidance(conversationState, 'not_found'),
            );
            return;
          }
          let outcome: Awaited<ReturnType<DispatchOptionSelection['execute']>>;
          try {
            outcome = await opts.dispatchOptionSelection.execute({
              userId,
              externalId,
              channel,
              conversationState,
              expected: semanticTurn.expected,
              snapshot: semanticTurn.snapshot,
              decision: semanticTurn.decision,
            });
          } catch (error) {
            opts.observeSemanticRouting.recordOptionDispatch?.(semanticTurn, {
              status: 'clarification_required',
              reason: 'dispatch_failed',
            });
            throw error;
          }
          opts.observeSemanticRouting.recordOptionDispatch?.(semanticTurn, outcome);
          opts.transitionState.assertExecutionIsValid(userId);
          if (outcome.status === 'clarification_required') {
            await messaging.sendMessage(
              externalId,
              semanticExpenseGuidance(conversationState, outcome.reason),
            );
          }
          return;
        }
        return deterministicDecision.kind === 'expense_guidance'
          ? opts.sendGuidance.execute(externalId)
          : routeByState(currentState, data, conversationState, opts, messaging);
      };
      if (conversationState) {
        await opts.transitionState.runWithState(conversationState, route);
      } else {
        await opts.transitionState.runForUser(userId, route);
      }
    } catch (err) {
      if (err instanceof StaleConversationStateError) return;
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
    clearInterval(renewalTimer);
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

  // A persisted financial claim is the durable authority after an append/delete
  // starts. No later message, callback, timeout-like command, or reconfiguration
  // may replace it while its outcome is unresolved.
  if (getFinancialExecutionClaim(conversationState?.statePayload ?? null) !== null) {
    await messaging.sendMessage(externalId, expenseCopies.financialOutcomeUnknown());
    return;
  }

  // Typed review callbacks are never global commands. Outside the exact
  // review state they must not cancel, reset, or otherwise mutate a flow.
  if (jobData.callbackData !== undefined && currentState !== 'EXPENSE_REVIEW') {
    await messaging.sendMessage(externalId, expenseCopies.noActiveReview());
    return;
  }

  // The immediate-undo token is valid for precisely the next inbound message.
  // Clear it before any other routing path, including global cancellation.
  const isImmediateUndoCommand = currentState === 'IDLE' && isUndoIntent(rawMessage);
  if (
    currentState === 'IDLE' &&
    conversationState?.statePayload?.immediateUndoExpenseId &&
    !isImmediateUndoCommand
  ) {
    await opts.transitionState.execute({ userId, targetState: 'IDLE', payload: null });
  }

  const cancellationSource = isCancelIntent(rawMessage) ? 'text' : null;
  const normalizedReviewPayload = tryNormalizeExpenseReviewPayload(conversationState?.statePayload);
  if (
    currentState === 'EXPENSE_REVIEW' &&
    isUndoIntent(rawMessage) &&
    normalizedReviewPayload?.immediateUndoExpenseId !== undefined &&
    opts.undoLastExpense &&
    conversationState !== null
  ) {
    const { immediateUndoExpenseId, ...reviewPayload } = normalizedReviewPayload;
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
        provenance: 'deterministic_command',
        immediateExpenseId: immediateUndoExpenseId,
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
    await presentExpenseSummary(userId, reviewPayload, messaging, externalId, opts);
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
      if (currentState === 'IDLE' && isUndoIntent(rawMessage) && opts.undoLastExpense) {
        const immediateUndoExpenseId = conversationState?.statePayload?.immediateUndoExpenseId;
        if (typeof immediateUndoExpenseId === 'string') {
          await opts.transitionState.execute({ userId, targetState: 'IDLE', payload: null });
        }
        const result = await opts.undoLastExpense.execute({
          userId,
          action: 'request',
          provenance: 'deterministic_command',
          ...(typeof immediateUndoExpenseId === 'string'
            ? { immediateExpenseId: immediateUndoExpenseId }
            : {}),
        });
        if (result.status === 'confirmation_required' && result.expense) {
          const current = opts.transitionState.currentState(userId);
          if (!current || !opts.presentUndoConfirmation) {
            await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
            break;
          }
          await opts.presentUndoConfirmation.execute({
            userId,
            chatId: externalId,
            expense: result.expense,
            expected: opts.transitionState.precondition(current, 'unexpired'),
          });
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
        await presentZeroAmountConfirmation(userId, result.payload, messaging, externalId, opts);
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
      await handleExpenseSavingRetry(jobData, conversationState, opts, messaging);
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
      const undoPayload = parseExpenseUndoPayload(conversationState?.statePayload);
      if (!undoPayload || !opts.undoLastExpense || conversationState === null) {
        await opts.transitionState.execute({ userId, targetState: 'IDLE' });
        await messaging.sendMessage(externalId, expenseCopies.undoNotFound());
        break;
      }

      if (isCancelIntent(rawMessage)) {
        await opts.transitionState.execute({ userId, targetState: 'IDLE', payload: null });
        await messaging.sendMessage(externalId, expenseCopies.undoCancelled());
        break;
      }

      if (conversationState.expiresAt === null) {
        await opts.transitionState.execute({ userId, targetState: 'IDLE', payload: null });
        await messaging.sendMessage(externalId, expenseCopies.undoNotFound());
        break;
      }
      if (conversationState.expiresAt.getTime() <= Date.now()) {
        await opts.transitionState.execute({
          userId,
          targetState: 'IDLE',
          payload: null,
          expected: opts.transitionState.precondition(conversationState, 'expired'),
        });
        await messaging.sendMessage(externalId, expenseCopies.undoExpired());
        break;
      }

      if (!undoPayload.actionBinding || undoPayload.actionBinding.presentedAt === null) {
        await representUndoConfirmation(userId, externalId, conversationState, opts, messaging);
        break;
      }

      if (!isConfirmIntent(rawMessage)) {
        await messaging.sendMessage(externalId, expenseCopies.ambiguousResponse());
        break;
      }

      const result = await opts.undoLastExpense.execute({
        userId,
        action: 'confirm',
        pendingExpenseId: undoPayload.pendingExpenseId,
        authorization: {
          receivedAt: jobData.receivedAt,
          sourceMessageId: jobData.externalMessageId,
        },
      });
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
      const categoryState = parseCategoryOnboardingState(categoryPayload);
      const hasCategories = categoryState !== null && categoryState.categories.length > 0;

      if (!hasCategories) {
        await enterOnboardingCategories(
          userId,
          externalId,
          channel,
          categoryPayload,
          opts,
          messaging,
        );
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
            categoryState.subcategoryColumnMapped
              ? onboardingCopies.categoryHierarchyConfirmationPrompt(
                  categoryState.categories,
                  categoryState.orphanSubcategories,
                )
              : onboardingCopies.categoryConfirmationPrompt(
                  categoryState.categories.map((category) => category.name),
                ),
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
        observedRevision: conversationState?.revision ?? '0',
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

function shouldQueueAdditionalExpense(
  currentState: string,
  statePayload: Record<string, unknown> | null,
  rawMessage: string,
  classifyFreeTextExpenseIntent: ClassifyFreeTextExpenseIntent,
): boolean {
  if (
    currentState !== 'EXPENSE_CLARIFYING' ||
    !isExpenseLikeIntent(classifyFreeTextExpenseIntent.execute(rawMessage))
  ) {
    return false;
  }

  try {
    return isNewExpenseDuringClarification(
      rawMessage,
      ExpenseClarificationState.fromPayload(statePayload).missingField,
    );
  } catch {
    return false;
  }
}

async function handleExpenseSavingRetry(
  jobData: ProcessMessageJobData,
  conversationState: ConversationState | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  const { userId, rawMessage, externalId, channel } = jobData;
  const retryPayload = parseExpenseSaveRetryPayload(conversationState?.statePayload);
  if (retryPayload === null || conversationState === null || conversationState.expiresAt === null) {
    await opts.transitionState.execute({ userId, targetState: 'IDLE', payload: null });
    await messaging.sendMessage(externalId, expenseCopies.saveRetryExpired());
    return;
  }
  if (conversationState.expiresAt.getTime() <= Date.now()) {
    await opts.transitionState.execute({
      userId,
      targetState: 'IDLE',
      payload: null,
      expected: opts.transitionState.precondition(conversationState, 'expired'),
    });
    await messaging.sendMessage(externalId, expenseCopies.saveRetryExpired());
    return;
  }

  const command = rawMessage.toLocaleLowerCase('es-AR').trim();
  if (command === 'reintentar') {
    if (!opts.retryExpenseSave) {
      await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
      return;
    }
    if (!retryPayload.actionBinding || retryPayload.actionBinding.presentedAt === null) {
      await representRetryAuthorization(
        userId,
        externalId,
        conversationState,
        retryPayload,
        opts,
        messaging,
      );
      return;
    }
    const outcome = await opts.retryExpenseSave.execute({
      userId,
      chatId: externalId,
      authorization: {
        receivedAt: jobData.receivedAt,
        sourceMessageId: jobData.externalMessageId,
      },
    });
    if (outcome.status === 'operation_in_progress') {
      await messaging.sendMessage(externalId, expenseCopies.financialOutcomeUnknown());
    } else if (outcome.status !== 'handled') {
      await messaging.sendMessage(externalId, expenseCopies.staleFinancialAction());
    }
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

async function representRetryAuthorization(
  userId: string,
  chatId: string,
  state: ConversationState,
  retryPayload: NonNullable<ReturnType<typeof parseExpenseSaveRetryPayload>>,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  const actionBinding = advanceExpenseReviewBinding(retryPayload.actionBinding);
  const payload = { ...retryPayload, actionBinding };
  await opts.transitionState.execute({
    userId,
    targetState: 'EXPENSE_SAVING_RETRY',
    payload,
    expiresAt: state.expiresAt,
  });
  const delivery = await messaging.sendMessage(chatId, expenseCopies.saveNetworkFailure());
  if (delivery.status === 'success') {
    await opts.transitionState.execute({
      userId,
      targetState: 'EXPENSE_SAVING_RETRY',
      payload: {
        ...payload,
        actionBinding: { ...actionBinding, presentedAt: new Date().toISOString() },
      },
      expiresAt: state.expiresAt,
    });
  }
}

async function representUndoConfirmation(
  userId: string,
  chatId: string,
  state: ConversationState,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  if (!opts.presentUndoConfirmation) {
    await messaging.sendMessage(chatId, expenseCopies.expenseRegistrationUnavailable());
    return;
  }
  const result = await opts.undoLastExpense!.execute({
    userId,
    action: 'request',
    provenance: 'deterministic_command',
  });
  if (result.status !== 'confirmation_required' || !result.expense) {
    await opts.transitionState.execute({ userId, targetState: 'IDLE', payload: null });
    await sendUndoOutcome(result, messaging, chatId);
    return;
  }
  await opts.presentUndoConfirmation.execute({
    userId,
    chatId,
    expense: result.expense,
    expected: opts.transitionState.precondition(state, 'unexpired'),
    ...(parseExpenseUndoPayload(state.statePayload)?.actionBinding === undefined
      ? {}
      : { previousBinding: parseExpenseUndoPayload(state.statePayload)!.actionBinding }),
  });
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
    case 'operation_in_progress':
      await messaging.sendMessage(chatId, expenseCopies.financialOutcomeUnknown());
      return;
    case 'expired':
      await messaging.sendMessage(chatId, expenseCopies.undoExpired());
      return;
    case 'stale':
    case 'unbound':
    case 'invalid':
      await messaging.sendMessage(chatId, expenseCopies.staleFinancialAction());
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
  forceNewBinding: boolean = false,
): Promise<void> {
  if (!opts.generateExpenseSummary || !opts.expenseSummaryPresenterFactory) {
    await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
    return;
  }

  const presenter = opts.expenseSummaryPresenterFactory(messaging, externalId);
  await opts.generateExpenseSummary.execute({
    userId,
    payload,
    presenter,
    ...(forceNewBinding ? { forceNewBinding: true } : {}),
  });
}

async function presentZeroAmountConfirmation(
  userId: string,
  payload: ExpenseReviewPayload,
  messaging: MessagingOutputPort,
  externalId: string,
  opts: MessageWorkerDeps,
): Promise<void> {
  await messaging.sendMessage(externalId, expenseCopies.zeroAmountConfirmation());
  const state = opts.transitionState.currentState(userId);
  const normalized = tryNormalizeExpenseReviewPayload(state?.statePayload ?? payload);
  if (
    state?.currentState !== 'EXPENSE_REVIEW' ||
    normalized?.reviewBinding === null ||
    normalized?.reviewBinding === undefined
  ) {
    return;
  }
  await opts.transitionState.execute({
    userId,
    targetState: 'EXPENSE_REVIEW',
    payload: {
      ...normalized,
      reviewBinding: { ...normalized.reviewBinding, presentedAt: new Date().toISOString() },
    },
    expiresAt: state.expiresAt,
  });
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
      const result = await opts.confirmColumnMapping.execute({
        userId,
        externalId,
        channel,
        statePayload,
      });

      if (result.nextState === 'ONBOARDING_CATEGORIES') {
        await enterOnboardingCategories(
          userId,
          externalId,
          channel,
          result.payload ?? null,
          opts,
          messaging,
        );
      }
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

async function enterOnboardingCategories(
  userId: string,
  externalId: string,
  channel: 'telegram' | 'whatsapp',
  statePayload: Record<string, unknown> | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  if (opts.detectCategories) {
    await opts.detectCategories.execute({
      userId,
      externalId,
      channel,
      statePayload,
    });
    return;
  }

  await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
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
  const reviewPayload = tryNormalizeExpenseReviewPayload(statePayload);

  // Inline-button actions (Phase 3) take precedence over legacy text intents.
  if (callbackData !== undefined) {
    if (!opts.resolveExpenseSummaryAction) {
      await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
      return;
    }

    if (reviewPayload === null) {
      opts.logger.error({
        msg: 'Missing or invalid expense review payload for callback action',
        endpoint: 'handleExpenseReview',
        code: 'INVALID_REVIEW_PAYLOAD',
        userId,
        action: 'action' in callbackData ? callbackData.action : 'invalid',
      });
      await opts.transitionState.execute({ userId, targetState: 'IDLE' });
      await messaging.sendMessage(externalId, expenseCopies.fallbackError());
      return;
    }

    const outcome = await opts.resolveExpenseSummaryAction.execute({
      userId,
      ...('action' in callbackData ? { action: callbackData.action } : {}),
      chatId: externalId,
      channel: jobData.channel,
      ...('action' in callbackData && callbackData.action === 'cancel'
        ? { cancellationSource: 'callback' as const }
        : {}),
      authorization: {
        kind: 'callback',
        callbackData,
        receivedAt: jobData.receivedAt,
        sourceMessageId: jobData.externalMessageId,
      },
    });
    await renderExpenseReviewReplyOutcome(outcome, userId, messaging, externalId, opts);
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

  if (!opts.resolveExpenseReviewReply) {
    await messaging.sendMessage(externalId, expenseCopies.expenseRegistrationUnavailable());
    return;
  }
  if (reviewPayload === null) {
    opts.logger.error({
      msg: 'Missing or invalid expense review payload for text reply',
      endpoint: 'handleExpenseReview',
      code: 'INVALID_REVIEW_PAYLOAD',
      userId,
    });
    await opts.transitionState.execute({ userId, targetState: 'IDLE' });
    await messaging.sendMessage(externalId, expenseCopies.fallbackError());
    return;
  }

  const outcome = await opts.resolveExpenseReviewReply.execute({
    userId,
    rawMessage,
    payload: reviewPayload,
    chatId: externalId,
    channel: jobData.channel,
    receivedAt: jobData.receivedAt,
    sourceMessageId: jobData.externalMessageId,
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
    intentMode: 'infer',
  });

  if (outcome.status === 'new_expense') {
    const queueOutcome = await opts.queuePendingExpense.execute({ userId, rawMessage, channel });
    if (queueOutcome.status === 'full') {
      await messaging.sendMessage(externalId, expenseCopies.expenseQueueFull());
    }
    return;
  }

  await renderExpenseReviewReplyOutcome(outcome, userId, messaging, externalId, opts);
}

async function renderExpenseReviewReplyOutcome(
  outcome:
    | ResolveExpenseReviewReplyOutcome
    | ResolveExpenseSummaryActionOutcome
    | Awaited<ReturnType<CorrectExpenseUseCase['execute']>>,
  userId: string,
  messaging: MessagingOutputPort,
  externalId: string,
  opts: MessageWorkerDeps,
): Promise<void> {
  switch (outcome.status) {
    case 'action_handled':
    case 'handled':
    case 'expense_queued':
      return;
    case 'review_required':
      await presentExpenseSummary(userId, outcome.payload, messaging, externalId, opts);
      return;
    case 'operation_in_progress':
      await messaging.sendMessage(externalId, expenseCopies.financialOutcomeUnknown());
      return;
    case 'expired': {
      const state = opts.transitionState.currentState(userId);
      const payload = tryNormalizeExpenseReviewPayload(state?.statePayload);
      if (state?.currentState !== 'EXPENSE_REVIEW' || payload === null) {
        await messaging.sendMessage(externalId, expenseCopies.noActiveReview());
        return;
      }
      const rebound = {
        ...payload,
        reminderSent: true,
        reviewBinding: advanceExpenseReviewBinding(payload.reviewBinding),
      };
      await opts.transitionState.execute({
        userId,
        targetState: 'EXPENSE_REVIEW',
        payload: rebound,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        expected: opts.transitionState.precondition(state, 'expired'),
      });
      await messaging.sendMessage(externalId, expenseCopies.expiredReview());
      await presentExpenseSummary(userId, rebound, messaging, externalId, opts);
      return;
    }
    case 'stale':
    case 'unbound':
    case 'invalid': {
      await messaging.sendMessage(externalId, expenseCopies.staleReview());
      const state = opts.transitionState.currentState(userId);
      const payload = tryNormalizeExpenseReviewPayload(state?.statePayload);
      if (state?.currentState === 'EXPENSE_REVIEW' && payload !== null) {
        await presentExpenseSummary(userId, payload, messaging, externalId, opts, true);
      }
      return;
    }
    case 'queue_full':
      await messaging.sendMessage(externalId, expenseCopies.expenseQueueFull());
      return;
    case 'new_expense':
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
    case 'invalid_subcategory':
      await messaging.sendMessage(externalId, expenseCopies.invalidSubcategory(outcome));
      return;
    case 'high_amount_confirmation':
    case 'corrected':
      await presentExpenseSummary(userId, outcome.payload, messaging, externalId, opts);
      return;
  }
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
      await presentZeroAmountConfirmation(userId, result.payload, messaging, externalId, opts);
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

  const result = await opts.completeExpenseClarification.execute({
    userId,
    rawReply: rawMessage,
    channel,
    statePayload,
  });

  if (result.status === 'needs_clarification') {
    const question =
      result.missingField === 'monto'
        ? expenseCopies.clarificationAmount()
        : expenseCopies.clarificationCurrency();
    await messaging.sendMessage(externalId, question);
  } else if (result.status === 'needs_zero_confirmation') {
    await presentZeroAmountConfirmation(userId, result.payload, messaging, externalId, opts);
  } else {
    await presentExpenseSummary(userId, result.payload, messaging, externalId, opts);
  }
}

function semanticExpenseGuidance(
  conversationState: ConversationState,
  reason:
    | Parameters<typeof expenseCopies.semanticExpenseGuidance>[0]
    | 'ambiguous_reference'
    | 'not_found'
    | 'stale_context',
): string {
  if (conversationState.currentState === 'ONBOARDING_FILE') {
    if (reason === 'ambiguous_reference') return onboardingCopies.ambiguousFileReference();
    if (reason === 'stale_context') return onboardingCopies.staleFileReference();
    return onboardingCopies.fileReferenceNotFound();
  }
  if (conversationState.currentState === 'ONBOARDING_SHEET') {
    if (reason === 'ambiguous_reference') return onboardingCopies.ambiguousSheetReference();
    if (reason === 'stale_context') return onboardingCopies.staleSheetReference();
    return onboardingCopies.sheetReferenceNotFound();
  }
  const expenseReason =
    reason === 'ambiguous_reference' || reason === 'not_found' ? 'unsupported_action' : reason;
  if (conversationState.currentState === 'EXPENSE_CLARIFYING') {
    try {
      const state = ExpenseClarificationState.fromPayload(conversationState.statePayload);
      return state.missingField === 'monto'
        ? expenseCopies.clarificationAmount()
        : expenseCopies.clarificationCurrency();
    } catch {
      return expenseCopies.semanticExpenseGuidance(expenseReason);
    }
  }
  if (conversationState.currentState === 'EXPENSE_REVIEW') {
    return expenseCopies.ambiguousResponse();
  }
  return expenseCopies.semanticExpenseGuidance(expenseReason);
}

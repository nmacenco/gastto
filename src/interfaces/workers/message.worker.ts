// LAYER: Interfaces
// BullMQ worker — Stage 2 of the async pipeline (ADR-005).
// Consumes `process-message` jobs in the same persistent process as Fastify.
// Responsibilities: FSM → NLP → user response.

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { RegisterExpenseUseCase } from '../../application/use-cases/expense/RegisterExpense';
import type { TransitionConversationState } from '../../application/use-cases/conversation/TransitionConversationState';
import type { RecoverCorruptedState } from '../../application/use-cases/conversation/RecoverCorruptedState';
import type { GetConversationState } from '../../application/use-cases/conversation/GetConversationState';
import type { MessagingOutputPort } from '../../application/ports/output/messaging.port';
import type { ProcessMessageJobData } from '../../application/ports/ProcessMessageJob';
import type { ExpenseReviewPayload } from '../../application/use-cases/expense/RegisterExpense';
import type { IUserRepository } from '../../domain/ports/repositories';
import type { InitiateCloudConnection } from '../../application/use-cases/spreadsheet/InitiateCloudConnection';
import type { CancelCloudConnection } from '../../application/use-cases/spreadsheet/CancelCloudConnection';
import type { HandleSpreadsheetFileSelection } from '../../application/use-cases/spreadsheet/HandleSpreadsheetFileSelection';
import type { HandleSheetSelection } from '../../application/use-cases/spreadsheet/HandleSheetSelection';
import type { ValidateSpreadsheetAccess } from '../../application/use-cases/spreadsheet/ValidateSpreadsheetAccess';
import type { InferColumnMapping } from '../../application/use-cases/spreadsheet/InferColumnMapping';
import type { ConfirmColumnMapping } from '../../application/use-cases/spreadsheet/ConfirmColumnMapping';
import { onboardingCopies } from '../../application/copies/onboarding.copies';
import { expenseCopies } from '../../application/copies/expense.copies';
import { isConfirmIntent, isCancelIntent } from '../../application/utils/intents';

export interface MessageWorkerDeps {
  redis: Redis;
  logger: Logger;
  registerExpense: RegisterExpenseUseCase;
  getConversationState: GetConversationState;
  transitionState: TransitionConversationState;
  recoverCorruptedState: RecoverCorruptedState;
  userRepo: IUserRepository;
  messagingAdapters: Record<'telegram' | 'whatsapp', MessagingOutputPort>;
  initiateCloudConnection?: InitiateCloudConnection | null;
  cancelCloudConnection?: CancelCloudConnection | null;
  handleSpreadsheetFileSelection?: HandleSpreadsheetFileSelection | null;
  handleSheetSelection?: HandleSheetSelection | null;
  validateSpreadsheetAccess?: ValidateSpreadsheetAccess | null;
  inferColumnMapping?: InferColumnMapping | null;
  confirmColumnMapping?: ConfirmColumnMapping | null;
}

export async function processMessageJob(
  job: Job<ProcessMessageJobData>,
  opts: MessageWorkerDeps,
): Promise<void> {
  const { userId, rawMessage, channel, externalId } = job.data;
  const messaging = opts.messagingAdapters[channel];

  // 1. Lee estado actual de la FSM
  const conversationState = await opts.getConversationState.execute({ userId });
  const currentState = conversationState?.currentState ?? 'IDLE';

  // 2. Recupera contexto del usuario para el LLM
  const user = await opts.userRepo.findById(userId);

  // 3. Route according to FSM state
  switch (currentState) {
    case 'IDLE':
    case 'EXPENSE_RECEIVING': {
      // Start expense interpretation
      const result = await opts.registerExpense.interpret({
        userId,
        rawMessage,
        channel,
        defaultCurrency: user?.defaultCurrency ?? null,
      });

      if (result.status === 'needs_clarification') {
        const question =
          result.missingField === 'monto'
            ? expenseCopies.clarificationAmount()
            : expenseCopies.clarificationCurrency();
        await messaging.sendMessage(externalId, question);
      } else {
        // Format and send summary for review (E1-US-06)
        const summary = formatExpenseSummary(result.payload);
        await messaging.sendMessage(externalId, summary);
      }
      break;
    }

    case 'EXPENSE_REVIEW': {
      // User is confirming, correcting or canceling
      await handleExpenseReview(job.data, conversationState?.statePayload ?? null, opts, messaging);
      break;
    }

    case 'EXPENSE_CLARIFYING': {
      // User is responding to a clarification question
      await handleClarification(job.data, conversationState?.statePayload ?? null, opts, messaging);
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
      if (opts.inferColumnMapping) {
        await opts.inferColumnMapping.execute({
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

    case 'ONBOARDING_CATEGORIES': {
      await messaging.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
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

export function createMessageWorker(opts: MessageWorkerDeps): Worker<ProcessMessageJobData> {
  const worker = new Worker<ProcessMessageJobData>(
    'process-message',
    async (job: Job<ProcessMessageJobData>) => processMessageJob(job, opts),
    {
      connection: opts.redis,
      concurrency: 2, // max 2 simultaneous jobs to not saturate LLM API (ADR-005)
      stalledInterval: 120_000, // 2 min (default 30s) — reduce Redis evalsha calls
      lockDuration: 120_000, // 2 min (default 30s) — LLM jobs can run >30s
      lockRenewTime: 60_000, // 1 min (default 15s) — fewer lock renewals
      // Retry policy is set on Queue, not Worker
    },
  );

  // Dead letter: jobs que agotan reintentos → log estructurado (ADR-005)
  worker.on('failed', (job, err) => {
    opts.logger.error({
      msg: 'Job failed permanently',
      jobId: job?.id,
      data: job?.data,
      error: err.message,
    });
  });

  return worker;
}

// ── Helpers de formato ────────────────────────────────────────────────────────

function formatExpenseSummary(payload: ExpenseReviewPayload): string {
  const { extracted, resolvedDate, resolvedCategory } = payload;
  const categoryLabel = resolvedCategory ?? '❓ Sin categoría';

  return expenseCopies.expenseSummary({
    rawMessage: payload.rawMessage,
    monto: extracted.monto,
    moneda: extracted.moneda,
    category: categoryLabel,
    categoryConfidence: extracted.confianzaCategoria,
    date: resolvedDate,
  });
}

async function handleExpenseReview(
  jobData: ProcessMessageJobData,
  statePayload: Record<string, unknown> | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  const { userId, rawMessage, externalId } = jobData;

  if (isConfirmIntent(rawMessage)) {
    // Guardado — pendiente de implementar llamada a registerExpense.save()
    await messaging.sendMessage(externalId, expenseCopies.saving());
  } else if (isCancelIntent(rawMessage)) {
    await opts.transitionState.execute({ userId, targetState: 'IDLE' });
    await messaging.sendMessage(externalId, expenseCopies.cancelled());
  } else {
    // Correction — re-interprets the message with the current summary context
    await messaging.sendMessage(externalId, expenseCopies.ambiguousResponse());
  }
}

async function handleClarification(
  jobData: ProcessMessageJobData,
  statePayload: Record<string, unknown> | null,
  opts: MessageWorkerDeps,
  messaging: MessagingOutputPort,
): Promise<void> {
  const { userId, rawMessage, externalId, channel } = jobData;
  const user = await opts.userRepo.findById(userId);

  // Retries interpretation with the user's clarification incorporated into the original message
  const partial = statePayload as { rawMessage?: string } | null;
  const originalMessage = partial?.rawMessage ?? '';
  const enrichedMessage = `${originalMessage} ${rawMessage}`.trim();

  const result = await opts.registerExpense.interpret({
    userId,
    rawMessage: enrichedMessage,
    channel,
    defaultCurrency: user?.defaultCurrency ?? null,
  });

  if (result.status === 'needs_clarification') {
    const question =
      result.missingField === 'monto'
        ? expenseCopies.clarificationAmount()
        : expenseCopies.clarificationCurrency();
    await messaging.sendMessage(externalId, question);
  } else {
    const summary = expenseCopies.updatedSummary({
      monto: result.payload.extracted.monto,
      moneda: result.payload.extracted.moneda,
      category: result.payload.resolvedCategory ?? '❓ Sin categoría',
      date: result.payload.resolvedDate,
    });
    await messaging.sendMessage(externalId, summary);
  }
}

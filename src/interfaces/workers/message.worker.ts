// LAYER: Interfaces
// BullMQ worker — Stage 2 of the async pipeline (ADR-005).
// Consumes `process-message` jobs in the same persistent process as Fastify.
// Responsibilities: FSM → NLP → user response.

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { RegisterExpenseUseCase } from '../../application/use-cases/expense/RegisterExpense';
import type { TransitionConversationState } from '../../application/use-cases/conversation/TransitionConversationState';
import type { RecoverCorruptedState } from '../../application/use-cases/conversation/RecoverCorruptedState';
import type { IConversationStateRepository } from '../../domain/ports/repositories';
import type { MessagingOutputPort } from '../../application/ports/output/messaging.port';
import type { ProcessMessageJobData } from '../../application/ports/ProcessMessageJob';
import type { ExpenseReviewPayload } from '../../application/use-cases/expense/RegisterExpense';
import type { IUserRepository } from '../../domain/ports/repositories';

export function createMessageWorker(opts: {
  redis: Redis;
  registerExpense: RegisterExpenseUseCase;
  conversationRepo: IConversationStateRepository;
  transitionState: TransitionConversationState;
  recoverCorruptedState: RecoverCorruptedState;
  userRepo: IUserRepository;
  messagingAdapters: Record<'telegram' | 'whatsapp', MessagingOutputPort>;
}): Worker<ProcessMessageJobData> {
  const worker = new Worker<ProcessMessageJobData>(
    'process-message',
    async (job: Job<ProcessMessageJobData>) => {
      const { userId, rawMessage, channel, externalId } = job.data;
      const messaging = opts.messagingAdapters[channel];

      // 1. Lee estado actual de la FSM
      const conversationState = await opts.conversationRepo.findByUserId(userId);
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
                ? '¿Cuánto gastaste?'
                : '¿En qué moneda fue ese gasto?';
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
          await handleExpenseReview(
            job.data,
            conversationState?.statePayload ?? null,
            opts,
            messaging,
          );
          break;
        }

        case 'EXPENSE_CLARIFYING': {
          // User is responding to a clarification question
          await handleClarification(
            job.data,
            conversationState?.statePayload ?? null,
            opts,
            messaging,
          );
          break;
        }

        case 'ONBOARDING_START':
        case 'ONBOARDING_DRIVE':
        case 'ONBOARDING_FILE':
        case 'ONBOARDING_SHEET':
        case 'ONBOARDING_MAPPING':
        case 'ONBOARDING_CATEGORIES': {
          // Onboarding: delegate to specific handler (pending implementation)
          await messaging.sendMessage(
            externalId,
            'Estamos configurando tu cuenta. Por favor sigue las instrucciones anteriores.',
          );
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
            await messaging.sendMessage(
              externalId,
              'Parece que algo falló. Vamos a empezar de nuevo.',
            );
          }
        }
      }
    },
    {
      connection: opts.redis,
      concurrency: 2, // max 2 simultaneous jobs to not saturate LLM API (ADR-005)
      // Retry policy is set on Queue, not Worker
    },
  );

  // Dead letter: jobs que agotan reintentos → log estructurado (ADR-005)
  worker.on('failed', (job, err) => {
    console.error({
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
  const confidenceNote = extracted.confianzaCategoria === 'baja' ? ' (¿correcto?)' : '';

  return [
    '📋 *Resumen del gasto:*',
    `• Concepto: ${payload.rawMessage.slice(0, 80)}`,
    `• Monto: ${extracted.monto} ${extracted.moneda}`,
    `• Categoría: ${categoryLabel}${confidenceNote}`,
    `• Fecha: ${resolvedDate}`,
    '',
    '¿Confirmamos? Responde *sí*, *corregir campo: valor*, o *cancelar*.',
  ].join('\n');
}

async function handleExpenseReview(
  jobData: ProcessMessageJobData,
  statePayload: Record<string, unknown> | null,
  opts: Parameters<typeof createMessageWorker>[0],
  messaging: MessagingOutputPort,
): Promise<void> {
  const { userId, rawMessage, externalId } = jobData;
  const lower = rawMessage.toLowerCase().trim();

  const CONFIRM_WORDS = [
    'sí',
    'si',
    'ok',
    'dale',
    'confirmo',
    'correcto',
    'listo',
    'va',
    'bárbaro',
    'okey',
    'perfecto',
    'yep',
    'sip',
  ];
  const CANCEL_WORDS = ['no', 'cancelar', 'cancela', 'no registres', 'para', 'stop', 'salir'];

  if (CONFIRM_WORDS.some((w) => lower === w || lower.startsWith(w + ' '))) {
    // Guardado — pendiente de implementar llamada a registerExpense.save()
    await messaging.sendMessage(externalId, 'Guardando tu gasto…');
  } else if (CANCEL_WORDS.some((w) => lower === w || lower.startsWith(w))) {
    await opts.transitionState.execute({ userId, targetState: 'IDLE' });
    await messaging.sendMessage(externalId, 'Registro cancelado. No se guardó nada.');
  } else {
    // Correction — re-interprets the message with the current summary context
    await messaging.sendMessage(externalId, '¿Querías confirmar, corregir o cancelar el registro?');
  }
}

async function handleClarification(
  jobData: ProcessMessageJobData,
  statePayload: Record<string, unknown> | null,
  opts: Parameters<typeof createMessageWorker>[0],
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
      result.missingField === 'monto' ? '¿Cuánto gastaste?' : '¿En qué moneda fue ese gasto?';
    await messaging.sendMessage(externalId, question);
  } else {
    const summary = [
      '📋 *Resumen actualizado:*',
      `• Monto: ${result.payload.extracted.monto} ${result.payload.extracted.moneda}`,
      `• Categoría: ${result.payload.resolvedCategory ?? '❓ Sin categoría'}`,
      `• Fecha: ${result.payload.resolvedDate}`,
      '',
      '¿Confirmamos? Responde *sí*, *corregir campo: valor*, o *cancelar*.',
    ].join('\n');
    await messaging.sendMessage(externalId, summary);
  }
}

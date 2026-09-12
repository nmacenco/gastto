// LAYER: Application. Runtime trust boundaries; domain types remain library-neutral.
import { z } from 'zod';
import { FSM_STATES } from '../../../domain/entities/ConversationState';
import type {
  SemanticRouterInput,
  SemanticRouterResult,
} from '../../../domain/ports/SemanticRouterPort';
import type { ConversationDecision } from '../../../domain/value-objects/conversation-decision';
import { allowedActionsFor } from './policy';

export const CONTRACT_VERSION = 'semantic-contract-v1';
export const actionSchema = z.enum([
  'register_expense',
  'cancel_current_flow',
  'correct_expense',
  'provide_missing_expense_data',
  'undo_last_expense',
  'select_option',
  'request_save_retry',
  'request_reconfiguration',
  'request_clarification',
  'out_of_scope',
]);
export const ConversationDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register_expense') }).strict(),
  z.object({ action: z.literal('cancel_current_flow') }).strict(),
  z.object({ action: z.literal('correct_expense') }).strict(),
  z.object({ action: z.literal('provide_missing_expense_data') }).strict(),
  z.object({ action: z.literal('undo_last_expense') }).strict(),
  z.object({ action: z.literal('request_save_retry') }).strict(),
  z.object({ action: z.literal('request_reconfiguration') }).strict(),
  z.object({ action: z.literal('out_of_scope') }).strict(),
  z
    .object({
      action: z.literal('select_option'),
      userReference: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal('request_clarification'),
      reason: z.enum([
        'ambiguous_intent',
        'mixed_intents',
        'ambiguous_reference',
        'explicit_confirmation_required',
      ]),
    })
    .strict(),
]) satisfies z.ZodType<ConversationDecision>;

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const date = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
  });
export const SemanticRouterInputSchema = z
  .object({
    rawMessage: z
      .string()
      .min(1)
      .max(8000)
      .refine((v) => v.trim().length > 0),
    state: z.enum(FSM_STATES),
    substep: z.string().min(1).max(80).nullable(),
    allowedActions: z.array(actionSchema).min(1).max(10),
    context: z
      .object({
        pendingQuestion: z.string().min(1).max(1000).nullable(),
        missingFields: z.array(z.enum(['monto', 'moneda'])).max(2),
        expense: z
          .object({
            amount: z.number().finite().nonnegative().nullable(),
            currency: z.enum(['ARS', 'EUR', 'USD', 'MXN', 'GBP', 'BRL']).nullable(),
            date: dateSchema.nullable(),
            concept: z.string().max(500).nullable(),
          })
          .strict()
          .nullable(),
        options: z
          .array(
            z
              .object({ position: z.number().int().positive(), label: z.string().min(1).max(200) })
              .strict(),
          )
          .max(20),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const allowed = allowedActionsFor(input.state, input.substep);
    if (!allowed || input.allowedActions.some((a) => !allowed.includes(a))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowedActions'],
        message: 'Unsupported state/substep or action expansion',
      });
    }
    if (
      new Set(input.allowedActions).size !== input.allowedActions.length ||
      new Set(input.context.missingFields).size !== input.context.missingFields.length ||
      new Set(input.context.options.map((o) => o.position)).size !== input.context.options.length
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate values' });
    }
    if (JSON.stringify(input).length > 20000)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Input too large' });
  }) satisfies z.ZodType<SemanticRouterInput>;

export const errorCodeSchema = z.enum([
  'INVALID_INPUT',
  'INPUT_TOO_LARGE',
  'UNSUPPORTED_CONFIGURATION',
  'TIMEOUT',
  'PROVIDER_ERROR',
  'MODEL_REFUSAL',
  'INVALID_OUTPUT',
  'OUTPUT_TOO_LARGE',
]);
export const metadataSchema = z
  .object({
    provider: z.string().regex(/^[a-zA-Z0-9._/-]{1,120}$/),
    model: z.string().regex(/^[a-zA-Z0-9._/-]{1,120}$/),
    promptVersion: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/),
    contractVersion: z.literal(CONTRACT_VERSION),
    latencyMs: z.number().finite().nonnegative(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
  })
  .strict();
export const SemanticRouterResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('proposed'),
      decision: ConversationDecisionSchema,
      metadata: metadataSchema,
    })
    .strict(),
  z
    .object({ status: z.literal('failed'), code: errorCodeSchema, metadata: metadataSchema })
    .strict(),
]) satisfies z.ZodType<SemanticRouterResult>;

export type ProposalAssessment =
  | { status: 'allowed' | 'forbidden_action'; decision: ConversationDecision }
  | { status: 'router_failure'; code: z.infer<typeof errorCodeSchema> };

export function assessSemanticProposal(
  input: SemanticRouterInput,
  result: SemanticRouterResult,
): ProposalAssessment {
  if (!SemanticRouterInputSchema.safeParse(input).success)
    return { status: 'router_failure', code: 'INVALID_INPUT' };
  const parsed = SemanticRouterResultSchema.safeParse(result);
  if (!parsed.success) return { status: 'router_failure', code: 'INVALID_OUTPUT' };
  if (parsed.data.status === 'failed') return { status: 'router_failure', code: parsed.data.code };
  return {
    status: input.allowedActions.includes(parsed.data.decision.action)
      ? 'allowed'
      : 'forbidden_action',
    decision: parsed.data.decision,
  };
}

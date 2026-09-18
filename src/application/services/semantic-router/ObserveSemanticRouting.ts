// LAYER: Application. Resolves one constrained semantic turn without business-effect ports.
import { z } from 'zod';
import {
  FSM_STATES,
  type ConversationState,
  type ConversationStatePrecondition,
} from '../../../domain/entities/ConversationState';
import type {
  SemanticRouterErrorCode,
  SemanticRouterPort,
} from '../../../domain/ports/SemanticRouterPort';
import type { ConversationDecision } from '../../../domain/value-objects/conversation-decision';
import {
  actionSchema,
  assessSemanticProposal,
  CONTRACT_VERSION,
  errorCodeSchema,
  SemanticRouterResultSchema,
} from './contracts';
import type { DeterministicRoutingDecision } from './deterministic-routing';
import {
  isExpenseCapabilityAllowed,
  isExpenseSemanticDecision,
  type ExpenseSemanticDecision,
} from './expense-capabilities';
import {
  isEnabledOptionSelectionState,
  isOptionSelectionSemanticDecision,
  shouldBypassSemanticOptionSelection,
  type OptionSelectionSemanticDecision,
} from './option-capabilities';
import {
  projectOptionSelectionSnapshot,
  type OptionSelectionSnapshot,
} from './ResolveOptionReference';
import { POLICY_VERSION } from './policy';
import type { ProjectSemanticRouterInput } from './ProjectSemanticRouterInput';
import type { SemanticRoutingMode, SemanticRoutingPolicy } from './runtime-policy';
import type { ValidateConversationSnapshot } from './ValidateConversationSnapshot';

export type SemanticPolicyOutcome =
  | 'allowed_shadow'
  | 'forbidden_action'
  | 'router_failure'
  | 'invalid_context'
  | 'stale_context'
  | 'deterministic_bypass'
  | 'not_sampled'
  | 'disabled'
  | 'enabled_capability_unavailable'
  | 'allowed_enabled'
  | 'dispatch_rejected'
  | 'dispatch_failed';

export type SemanticFallbackReason =
  | 'state_off'
  | 'outside_cohort'
  | 'not_sampled'
  | 'deterministic_bypass'
  | 'shadow_only';

export type SemanticRoutingTurnOutcome =
  | { readonly status: 'deterministic'; readonly reason: SemanticFallbackReason }
  | {
      readonly status: 'expense_action';
      readonly decision: ExpenseSemanticDecision;
      readonly expected: ConversationStatePrecondition;
    }
  | {
      readonly status: 'option_selection';
      readonly decision: OptionSelectionSemanticDecision;
      readonly expected: ConversationStatePrecondition;
      readonly snapshot: OptionSelectionSnapshot;
    }
  | {
      readonly status: 'clarification';
      readonly reason:
        | 'ambiguous_intent'
        | 'mixed_intents'
        | 'ambiguous_reference'
        | 'not_found'
        | 'stale_context'
        | 'unsupported_action';
    };

export interface ResolveSemanticRoutingTurn {
  execute(input: {
    readonly userId: string;
    readonly externalMessageId: string;
    readonly rawMessage: string;
    readonly conversationState: ConversationState;
    readonly deterministicDecision: DeterministicRoutingDecision;
  }): Promise<SemanticRoutingTurnOutcome>;
}

export interface SemanticRoutingObservation {
  readonly event: 'semantic_router_observation';
  readonly mode: SemanticRoutingMode;
  readonly state: ConversationState['currentState'];
  readonly substep: string | null;
  readonly deterministicDecision: DeterministicRoutingDecision['kind'];
  readonly proposedAction: ConversationDecision['action'] | null;
  readonly policyOutcome: SemanticPolicyOutcome;
  readonly provider: string | null;
  readonly model: string | null;
  readonly promptVersion: string | null;
  readonly contractVersion: string;
  readonly policyVersion: string;
  readonly latencyMs: number | null;
  readonly errorCode:
    | SemanticRouterErrorCode
    | 'STALE_CONTEXT'
    | 'INVALID_STATE_CONTEXT'
    | 'ENABLED_CAPABILITY_UNAVAILABLE'
    | null;
}

export const SemanticRoutingObservationSchema = z
  .object({
    event: z.literal('semantic_router_observation'),
    mode: z.enum(['off', 'shadow', 'enabled']),
    state: z.enum(FSM_STATES),
    substep: z.string().min(1).max(80).nullable(),
    deterministicDecision: z.enum([
      'fsm_handler',
      'expense_guidance',
      'typed_callback',
      'sensitive_command',
      'unsupported',
    ]),
    proposedAction: actionSchema.nullable(),
    policyOutcome: z.enum([
      'allowed_shadow',
      'forbidden_action',
      'router_failure',
      'invalid_context',
      'stale_context',
      'deterministic_bypass',
      'not_sampled',
      'disabled',
      'enabled_capability_unavailable',
      'allowed_enabled',
      'dispatch_rejected',
      'dispatch_failed',
    ]),
    provider: z
      .string()
      .regex(/^[a-zA-Z0-9._/-]{1,120}$/)
      .nullable(),
    model: z
      .string()
      .regex(/^[a-zA-Z0-9._/-]{1,120}$/)
      .nullable(),
    promptVersion: z
      .string()
      .regex(/^[a-zA-Z0-9._-]{1,80}$/)
      .nullable(),
    contractVersion: z.literal(CONTRACT_VERSION),
    policyVersion: z.literal(POLICY_VERSION),
    latencyMs: z.number().finite().nonnegative().nullable(),
    errorCode: errorCodeSchema
      .or(z.enum(['STALE_CONTEXT', 'INVALID_STATE_CONTEXT', 'ENABLED_CAPABILITY_UNAVAILABLE']))
      .nullable(),
  })
  .strict() satisfies z.ZodType<SemanticRoutingObservation>;

export interface SemanticRoutingTelemetryPort {
  record(observation: SemanticRoutingObservation): void;
}

interface ObserveSemanticRoutingDeps {
  readonly policy: SemanticRoutingPolicy;
  readonly projector: Pick<ProjectSemanticRouterInput, 'execute' | 'substepFor'>;
  readonly router: SemanticRouterPort | null;
  readonly snapshotValidator: Pick<ValidateConversationSnapshot, 'execute'>;
  readonly telemetry: SemanticRoutingTelemetryPort;
  readonly optionSelectionAvailable?: boolean;
}

export class ObserveSemanticRouting implements ResolveSemanticRoutingTurn {
  private readonly pendingDispatchObservations = new WeakMap<
    Extract<SemanticRoutingTurnOutcome, { status: 'expense_action' | 'option_selection' }>,
    SemanticRoutingObservation
  >();

  constructor(private readonly deps: ObserveSemanticRoutingDeps) {}

  recordExpenseDispatch(
    turn: Extract<SemanticRoutingTurnOutcome, { status: 'expense_action' }>,
    outcome: { readonly status: string; readonly reason?: string },
  ): void {
    this.recordDispatch(turn, outcome);
  }

  recordOptionDispatch(
    turn: Extract<SemanticRoutingTurnOutcome, { status: 'option_selection' }>,
    outcome: { readonly status: string; readonly reason?: string },
  ): void {
    this.recordDispatch(turn, outcome);
  }

  private recordDispatch(
    turn: Extract<SemanticRoutingTurnOutcome, { status: 'expense_action' | 'option_selection' }>,
    outcome: { readonly status: string; readonly reason?: string },
  ): void {
    const observation = this.pendingDispatchObservations.get(turn);
    if (!observation) return;
    this.pendingDispatchObservations.delete(turn);
    this.record({
      ...observation,
      policyOutcome:
        outcome.status === 'clarification_required'
          ? outcome.reason === 'dispatch_failed'
            ? 'dispatch_failed'
            : 'dispatch_rejected'
          : outcome.status === 'selection_rejected'
            ? 'dispatch_rejected'
            : 'allowed_enabled',
    });
  }

  async execute(input: {
    readonly userId: string;
    readonly externalMessageId: string;
    readonly rawMessage: string;
    readonly conversationState: ConversationState;
    readonly deterministicDecision: DeterministicRoutingDecision;
  }): Promise<SemanticRoutingTurnOutcome> {
    const messageKind =
      input.deterministicDecision.kind === 'typed_callback'
        ? 'typed_callback'
        : input.deterministicDecision.kind === 'sensitive_command'
          ? 'sensitive_command'
          : shouldBypassSemanticOptionSelection(input.conversationState, input.rawMessage)
            ? 'sensitive_command'
            : 'free_text';
    const substep = this.deps.projector.substepFor(input.conversationState);
    const resolution = this.deps.policy.resolve({
      userId: input.userId,
      externalMessageId: input.externalMessageId,
      state: input.conversationState.currentState,
      substep,
      messageKind,
      providerAvailable: this.deps.router !== null,
    });
    const base = {
      event: 'semantic_router_observation' as const,
      state: input.conversationState.currentState,
      substep,
      deterministicDecision: input.deterministicDecision.kind,
      proposedAction: null,
      provider: null,
      model: null,
      promptVersion: null,
      contractVersion: CONTRACT_VERSION,
      policyVersion: POLICY_VERSION,
      latencyMs: null,
      errorCode: null,
    };

    if (resolution.mode === 'off') {
      this.record({
        ...base,
        mode: 'off',
        policyOutcome:
          resolution.reason === 'deterministic_bypass'
            ? 'deterministic_bypass'
            : resolution.reason === 'not_sampled' || resolution.reason === 'outside_cohort'
              ? 'not_sampled'
              : 'disabled',
      });
      return { status: 'deterministic', reason: resolution.reason };
    }
    if (resolution.mode === 'unavailable') {
      if (resolution.code === 'UNSUPPORTED_CONFIGURATION') {
        const projection = this.deps.projector.execute({
          rawMessage: input.rawMessage,
          conversationState: input.conversationState,
        });
        if (projection.status === 'unsupported') {
          this.record({
            ...base,
            mode: resolution.requestedMode,
            policyOutcome: 'invalid_context',
            errorCode: 'INVALID_STATE_CONTEXT',
          });
          return resolution.requestedMode === 'enabled'
            ? { status: 'clarification', reason: 'unsupported_action' }
            : { status: 'deterministic', reason: 'shadow_only' };
        }
      }
      this.record({
        ...base,
        mode: resolution.requestedMode,
        policyOutcome:
          resolution.code === 'ENABLED_CAPABILITY_UNAVAILABLE'
            ? 'enabled_capability_unavailable'
            : 'router_failure',
        errorCode: resolution.code === 'PROVIDER_UNAVAILABLE' ? 'PROVIDER_ERROR' : resolution.code,
      });
      return resolution.requestedMode === 'enabled'
        ? { status: 'clarification', reason: 'unsupported_action' }
        : { status: 'deterministic', reason: 'shadow_only' };
    }

    const projection = this.deps.projector.execute({
      rawMessage: input.rawMessage,
      conversationState: input.conversationState,
    });
    if (projection.status === 'unsupported') {
      this.record({
        ...base,
        mode: resolution.mode,
        policyOutcome: 'invalid_context',
        errorCode: 'INVALID_STATE_CONTEXT',
      });
      return resolution.mode === 'enabled'
        ? { status: 'clarification', reason: 'unsupported_action' }
        : { status: 'deterministic', reason: 'shadow_only' };
    }

    const startedAt = performance.now();
    let result;
    try {
      result = await this.deps.router!.decide(projection.input);
    } catch {
      if (!(await this.snapshotIsCurrent(input))) {
        this.record({
          ...base,
          mode: resolution.mode,
          policyOutcome: 'stale_context',
          latencyMs: performance.now() - startedAt,
          errorCode: 'STALE_CONTEXT',
        });
        return resolution.mode === 'enabled'
          ? { status: 'clarification', reason: 'stale_context' }
          : { status: 'deterministic', reason: 'shadow_only' };
      }
      this.record({
        ...base,
        mode: resolution.mode,
        policyOutcome: 'router_failure',
        latencyMs: performance.now() - startedAt,
        errorCode: 'PROVIDER_ERROR',
      });
      return resolution.mode === 'enabled'
        ? { status: 'clarification', reason: 'unsupported_action' }
        : { status: 'deterministic', reason: 'shadow_only' };
    }
    const parsedResult = SemanticRouterResultSchema.safeParse(result);
    if (!parsedResult.success) {
      this.record({
        ...base,
        mode: resolution.mode,
        policyOutcome: 'router_failure',
        latencyMs: performance.now() - startedAt,
        errorCode: 'INVALID_OUTPUT',
      });
      return resolution.mode === 'enabled'
        ? { status: 'clarification', reason: 'unsupported_action' }
        : { status: 'deterministic', reason: 'shadow_only' };
    }
    result = parsedResult.data;
    const metadata = {
      provider: result.metadata.provider,
      model: result.metadata.model,
      promptVersion: result.metadata.promptVersion,
      latencyMs: result.metadata.latencyMs,
    };
    if (!(await this.snapshotIsCurrent(input))) {
      this.record({
        ...base,
        ...metadata,
        mode: resolution.mode,
        proposedAction: result.status === 'proposed' ? result.decision.action : null,
        policyOutcome: 'stale_context',
        errorCode: 'STALE_CONTEXT',
      });
      return resolution.mode === 'enabled'
        ? { status: 'clarification', reason: 'stale_context' }
        : { status: 'deterministic', reason: 'shadow_only' };
    }
    const assessment = assessSemanticProposal(projection.input, result);
    if (assessment.status === 'router_failure') {
      this.record({
        ...base,
        ...metadata,
        mode: resolution.mode,
        policyOutcome: 'router_failure',
        errorCode: assessment.code,
      });
      return resolution.mode === 'enabled'
        ? { status: 'clarification', reason: 'unsupported_action' }
        : { status: 'deterministic', reason: 'shadow_only' };
    }

    if (resolution.mode === 'shadow') {
      this.record({
        ...base,
        ...metadata,
        mode: 'shadow',
        proposedAction: assessment.decision.action,
        policyOutcome: assessment.status === 'allowed' ? 'allowed_shadow' : 'forbidden_action',
      });
      return { status: 'deterministic', reason: 'shadow_only' };
    }

    if (assessment.status !== 'allowed') {
      this.record({
        ...base,
        ...metadata,
        mode: 'enabled',
        proposedAction: assessment.decision.action,
        policyOutcome: 'forbidden_action',
        errorCode: null,
      });
      return { status: 'clarification', reason: 'unsupported_action' };
    }

    if (
      assessment.decision.action === 'request_clarification' ||
      assessment.decision.action === 'out_of_scope'
    ) {
      this.record({
        ...base,
        ...metadata,
        mode: 'enabled',
        proposedAction: assessment.decision.action,
        policyOutcome: 'allowed_enabled',
      });
      return {
        status: 'clarification',
        reason:
          assessment.decision.action === 'request_clarification' &&
          (assessment.decision.reason === 'ambiguous_intent' ||
            assessment.decision.reason === 'mixed_intents')
            ? assessment.decision.reason
            : 'unsupported_action',
      };
    }

    const expected = {
      revision: input.conversationState.revision,
      currentState: input.conversationState.currentState,
      expiry: 'unexpired',
    } as const;
    const observation: SemanticRoutingObservation = {
      ...base,
      ...metadata,
      mode: 'enabled',
      proposedAction: assessment.decision.action,
      policyOutcome: 'allowed_enabled',
    };

    if (isOptionSelectionSemanticDecision(assessment.decision)) {
      const snapshot = projectOptionSelectionSnapshot(input.conversationState);
      if (
        this.deps.optionSelectionAvailable === false ||
        !isEnabledOptionSelectionState(input.conversationState) ||
        snapshot === null
      ) {
        this.record({
          ...observation,
          policyOutcome: 'enabled_capability_unavailable',
          errorCode: 'ENABLED_CAPABILITY_UNAVAILABLE',
        });
        return { status: 'clarification', reason: 'unsupported_action' };
      }
      const turn = {
        status: 'option_selection',
        decision: assessment.decision,
        expected,
        snapshot,
      } as const;
      this.pendingDispatchObservations.set(turn, observation);
      return turn;
    }

    if (
      !isExpenseSemanticDecision(assessment.decision) ||
      !isExpenseCapabilityAllowed(input.conversationState.currentState, assessment.decision)
    ) {
      this.record({
        ...observation,
        policyOutcome: 'enabled_capability_unavailable',
        errorCode: 'ENABLED_CAPABILITY_UNAVAILABLE',
      });
      return { status: 'clarification', reason: 'unsupported_action' };
    }

    const turn = {
      status: 'expense_action',
      decision: assessment.decision,
      expected,
    } as const;
    this.pendingDispatchObservations.set(turn, observation);
    return turn;
  }

  private async snapshotIsCurrent(input: {
    readonly userId: string;
    readonly conversationState: ConversationState;
  }): Promise<boolean> {
    try {
      const snapshot = await this.deps.snapshotValidator.execute({
        userId: input.userId,
        expected: {
          revision: input.conversationState.revision,
          currentState: input.conversationState.currentState,
          expiry: 'unexpired',
        },
      });
      return snapshot.status === 'current';
    } catch {
      return false;
    }
  }

  private record(observation: SemanticRoutingObservation): SemanticRoutingObservation {
    const parsed = SemanticRoutingObservationSchema.safeParse(observation);
    if (!parsed.success) return observation;
    try {
      this.deps.telemetry.record(parsed.data);
    } catch {
      // Shadow telemetry must never prevent the deterministic route.
    }
    return parsed.data;
  }
}

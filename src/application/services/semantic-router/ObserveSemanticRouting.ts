// LAYER: Application. Shadow-only semantic orchestration with no business-effect ports.
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type {
  SemanticRouterErrorCode,
  SemanticRouterPort,
} from '../../../domain/ports/SemanticRouterPort';
import type { ConversationDecision } from '../../../domain/value-objects/conversation-decision';
import { assessSemanticProposal, CONTRACT_VERSION } from './contracts';
import type { DeterministicRoutingDecision } from './deterministic-routing';
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
  | 'enabled_capability_unavailable';

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

export interface SemanticRoutingTelemetryPort {
  record(observation: SemanticRoutingObservation): void;
}

interface ObserveSemanticRoutingDeps {
  readonly policy: SemanticRoutingPolicy;
  readonly projector: Pick<ProjectSemanticRouterInput, 'execute'>;
  readonly router: SemanticRouterPort | null;
  readonly snapshotValidator: Pick<ValidateConversationSnapshot, 'execute'>;
  readonly telemetry: SemanticRoutingTelemetryPort;
}

export class ObserveSemanticRouting {
  constructor(private readonly deps: ObserveSemanticRoutingDeps) {}

  async execute(input: {
    readonly userId: string;
    readonly externalMessageId: string;
    readonly rawMessage: string;
    readonly conversationState: ConversationState;
    readonly deterministicDecision: DeterministicRoutingDecision;
  }): Promise<SemanticRoutingObservation> {
    const messageKind =
      input.deterministicDecision.kind === 'typed_callback'
        ? 'typed_callback'
        : input.deterministicDecision.kind === 'sensitive_command'
          ? 'sensitive_command'
          : 'free_text';
    const resolution = this.deps.policy.resolve({
      userId: input.userId,
      externalMessageId: input.externalMessageId,
      state: input.conversationState.currentState,
      substep: null,
      messageKind,
      providerAvailable: this.deps.router !== null,
    });
    const base = {
      event: 'semantic_router_observation' as const,
      state: input.conversationState.currentState,
      substep: null,
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
      return this.record({
        ...base,
        mode: 'off',
        policyOutcome:
          resolution.reason === 'deterministic_bypass'
            ? 'deterministic_bypass'
            : resolution.reason === 'not_sampled' || resolution.reason === 'outside_cohort'
              ? 'not_sampled'
              : 'disabled',
      });
    }
    if (resolution.mode === 'unavailable') {
      return this.record({
        ...base,
        mode: resolution.code === 'ENABLED_CAPABILITY_UNAVAILABLE' ? 'enabled' : 'shadow',
        policyOutcome:
          resolution.code === 'ENABLED_CAPABILITY_UNAVAILABLE'
            ? 'enabled_capability_unavailable'
            : 'router_failure',
        errorCode: resolution.code === 'PROVIDER_UNAVAILABLE' ? 'PROVIDER_ERROR' : resolution.code,
      });
    }

    const projection = this.deps.projector.execute({
      rawMessage: input.rawMessage,
      conversationState: input.conversationState,
    });
    if (projection.status === 'unsupported') {
      return this.record({
        ...base,
        mode: resolution.mode,
        policyOutcome: 'invalid_context',
        errorCode: 'INVALID_STATE_CONTEXT',
      });
    }

    const startedAt = performance.now();
    let result;
    try {
      result = await this.deps.router!.decide(projection.input);
    } catch {
      return this.record({
        ...base,
        mode: resolution.mode,
        policyOutcome: 'router_failure',
        latencyMs: performance.now() - startedAt,
        errorCode: 'PROVIDER_ERROR',
      });
    }
    const metadata = {
      provider: result.metadata.provider,
      model: result.metadata.model,
      promptVersion: result.metadata.promptVersion,
      latencyMs: result.metadata.latencyMs,
    };
    const assessment = assessSemanticProposal(projection.input, result);
    if (assessment.status === 'router_failure') {
      return this.record({
        ...base,
        ...metadata,
        mode: resolution.mode,
        policyOutcome: 'router_failure',
        errorCode: assessment.code,
      });
    }

    const snapshot = await this.deps.snapshotValidator.execute({
      userId: input.userId,
      expected: {
        revision: input.conversationState.revision,
        currentState: input.conversationState.currentState,
        expiry: 'unexpired',
      },
    });
    if (snapshot.status !== 'current') {
      return this.record({
        ...base,
        ...metadata,
        mode: resolution.mode,
        proposedAction: assessment.decision.action,
        policyOutcome: 'stale_context',
        errorCode: 'STALE_CONTEXT',
      });
    }
    return this.record({
      ...base,
      ...metadata,
      mode: resolution.mode,
      proposedAction: assessment.decision.action,
      policyOutcome: assessment.status === 'allowed' ? 'allowed_shadow' : 'forbidden_action',
    });
  }

  private record(observation: SemanticRoutingObservation): SemanticRoutingObservation {
    try {
      this.deps.telemetry.record(observation);
    } catch {
      // Shadow telemetry must never prevent the deterministic route.
    }
    return observation;
  }
}

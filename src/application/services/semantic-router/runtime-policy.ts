// LAYER: Application. Deterministic rollout selection; never authorizes effects.
import { createHash } from 'node:crypto';
import type { FsmState } from '../../../domain/entities/ConversationState';
import { allowedActionsFor } from './policy';
import { isEnabledExpenseState } from './expense-capabilities';

export type SemanticRoutingMode = 'off' | 'shadow' | 'enabled';

export interface SemanticRoutingConfig {
  readonly stateModes: Readonly<Partial<Record<FsmState, SemanticRoutingMode>>>;
  readonly cohortPercent: number;
  readonly shadowSamplePercent: number;
  readonly cohortSeed: string;
}

export interface SemanticRoutingResolutionInput {
  readonly userId: string;
  readonly externalMessageId: string;
  readonly state: FsmState;
  readonly substep: string | null;
  readonly messageKind: 'free_text' | 'typed_callback' | 'sensitive_command';
  readonly providerAvailable: boolean;
}

export type SemanticRoutingResolution =
  | {
      readonly mode: 'off';
      readonly reason: 'state_off' | 'outside_cohort' | 'not_sampled' | 'deterministic_bypass';
    }
  | { readonly mode: 'shadow'; readonly cohortBucket: number; readonly sampleBucket: number }
  | { readonly mode: 'enabled'; readonly cohortBucket: number; readonly sampleBucket: number }
  | {
      readonly mode: 'unavailable';
      readonly requestedMode: 'shadow' | 'enabled';
      readonly code:
        | 'UNSUPPORTED_CONFIGURATION'
        | 'PROVIDER_UNAVAILABLE'
        | 'ENABLED_CAPABILITY_UNAVAILABLE';
    };

export interface SemanticRoutingPolicy {
  admitsForObservation(userId: string): boolean;
  resolve(input: SemanticRoutingResolutionInput): SemanticRoutingResolution;
}

function stableBucket(seed: string, value: string): number {
  return (
    createHash('sha256').update(seed).update('\0').update(value).digest().readUInt32BE(0) % 100
  );
}

export class Sha256SemanticRoutingPolicy implements SemanticRoutingPolicy {
  constructor(private readonly config: SemanticRoutingConfig) {}

  admitsForObservation(userId: string): boolean {
    const hasConfiguredState = Object.values(this.config.stateModes).some((mode) => mode !== 'off');
    return (
      hasConfiguredState &&
      this.config.cohortPercent > 0 &&
      stableBucket(this.config.cohortSeed, userId) < this.config.cohortPercent
    );
  }

  resolve(input: SemanticRoutingResolutionInput): SemanticRoutingResolution {
    const configuredMode = this.config.stateModes[input.state] ?? 'off';
    if (configuredMode === 'off') return { mode: 'off', reason: 'state_off' };
    if (input.messageKind !== 'free_text') {
      return { mode: 'off', reason: 'deterministic_bypass' };
    }
    if (!allowedActionsFor(input.state, input.substep)) {
      return {
        mode: 'unavailable',
        requestedMode: configuredMode,
        code: 'UNSUPPORTED_CONFIGURATION',
      };
    }

    const cohortBucket = stableBucket(this.config.cohortSeed, input.userId);
    if (cohortBucket >= this.config.cohortPercent) {
      return { mode: 'off', reason: 'outside_cohort' };
    }
    const sampleBucket = stableBucket(this.config.cohortSeed, input.externalMessageId);
    if (sampleBucket >= this.config.shadowSamplePercent) {
      return { mode: 'off', reason: 'not_sampled' };
    }
    if (!input.providerAvailable)
      return { mode: 'unavailable', requestedMode: configuredMode, code: 'PROVIDER_UNAVAILABLE' };
    if (configuredMode === 'enabled') {
      if (!isEnabledExpenseState(input.state)) {
        return {
          mode: 'unavailable',
          requestedMode: configuredMode,
          code: 'ENABLED_CAPABILITY_UNAVAILABLE',
        };
      }
      return { mode: 'enabled', cohortBucket, sampleBucket };
    }
    return { mode: 'shadow', cohortBucket, sampleBucket };
  }
}

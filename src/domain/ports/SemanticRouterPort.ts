// LAYER: Domain
import type { FsmState } from '../entities/ConversationState';
import type { ConversationDecision } from '../value-objects/conversation-decision';

export interface SemanticRouterContext {
  readonly pendingQuestion: string | null;
  readonly missingFields: readonly string[];
  readonly expense: {
    readonly amount: number | null;
    readonly currency: string | null;
    readonly date: string | null;
    readonly concept: string | null;
  } | null;
  readonly options: readonly { readonly position: number; readonly label: string }[];
}
export interface SemanticRouterInput {
  readonly rawMessage: string;
  readonly state: FsmState;
  readonly substep: string | null;
  readonly allowedActions: readonly ConversationDecision['action'][];
  readonly context: SemanticRouterContext;
}
export type SemanticRouterErrorCode =
  | 'INVALID_INPUT'
  | 'INPUT_TOO_LARGE'
  | 'UNSUPPORTED_CONFIGURATION'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'MODEL_REFUSAL'
  | 'INVALID_OUTPUT'
  | 'OUTPUT_TOO_LARGE';
export interface SemanticRouterMetadata {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly contractVersion: string;
  readonly latencyMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}
export type SemanticRouterResult =
  | {
      readonly status: 'proposed';
      readonly decision: ConversationDecision;
      readonly metadata: SemanticRouterMetadata;
    }
  | {
      readonly status: 'failed';
      readonly code: SemanticRouterErrorCode;
      readonly metadata: SemanticRouterMetadata;
    };
export interface SemanticRouterPort {
  decide(input: SemanticRouterInput): Promise<SemanticRouterResult>;
}

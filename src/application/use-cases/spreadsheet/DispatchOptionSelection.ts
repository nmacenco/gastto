// LAYER: Application. Resolves an untrusted semantic reference to one displayed file position.
import type {
  ConversationState,
  ConversationStatePrecondition,
} from '../../../domain/entities/ConversationState';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';
import type { OptionSelectionSemanticDecision } from '../../services/semantic-router/option-capabilities';
import {
  projectOptionSelectionSnapshot,
  type OptionSelectionSnapshot,
  type ResolveOptionReference,
} from '../../services/semantic-router/ResolveOptionReference';
import type { ValidateConversationSnapshot } from '../../services/semantic-router/ValidateConversationSnapshot';
import type { HandleSpreadsheetFileSelection } from './HandleSpreadsheetFileSelection';

export interface DispatchOptionSelectionInput {
  readonly userId: string;
  readonly externalId: string;
  readonly channel: 'telegram' | 'whatsapp';
  readonly conversationState: ConversationState;
  readonly expected: ConversationStatePrecondition;
  readonly snapshot: OptionSelectionSnapshot;
  readonly decision: OptionSelectionSemanticDecision;
}

export type DispatchOptionSelectionOutcome =
  | { readonly status: 'selected'; readonly target: 'file' }
  | {
      readonly status: 'clarification_required';
      readonly reason: 'ambiguous_reference' | 'not_found' | 'stale_context';
    }
  | { readonly status: 'selection_rejected'; readonly target: 'file' };

export class DispatchOptionSelection {
  constructor(
    private readonly deps: {
      readonly snapshotValidator: Pick<ValidateConversationSnapshot, 'execute'>;
      readonly resolver: Pick<ResolveOptionReference, 'execute'>;
      readonly fileSelection: Pick<HandleSpreadsheetFileSelection, 'selectDisplayedFile'>;
    },
  ) {}

  async execute(input: DispatchOptionSelectionInput): Promise<DispatchOptionSelectionOutcome> {
    const checked = await this.deps.snapshotValidator.execute({
      userId: input.userId,
      expected: input.expected,
    });
    if (checked.status !== 'current') {
      return { status: 'clarification_required', reason: 'stale_context' };
    }

    const current = projectOptionSelectionSnapshot(checked.state);
    if (current === null || current.state !== 'ONBOARDING_FILE') {
      return { status: 'clarification_required', reason: 'stale_context' };
    }
    const resolution = this.deps.resolver.execute({
      userReference: input.decision.userReference,
      expected: input.snapshot,
      current,
    });
    if (resolution.status === 'ambiguous') {
      return { status: 'clarification_required', reason: 'ambiguous_reference' };
    }
    if (resolution.status === 'not_found') {
      return { status: 'clarification_required', reason: 'not_found' };
    }
    if (resolution.status === 'stale') {
      return { status: 'clarification_required', reason: 'stale_context' };
    }

    try {
      const selected = await this.deps.fileSelection.selectDisplayedFile({
        userId: input.userId,
        externalId: input.externalId,
        channel: input.channel,
        statePayload: checked.state.statePayload,
        position: resolution.position,
        expected: input.expected,
      });
      return selected.nextState === 'ONBOARDING_SHEET'
        ? { status: 'selected', target: 'file' }
        : { status: 'selection_rejected', target: 'file' };
    } catch (error) {
      if (error instanceof StaleConversationStateError) {
        return { status: 'clarification_required', reason: 'stale_context' };
      }
      throw error;
    }
  }
}

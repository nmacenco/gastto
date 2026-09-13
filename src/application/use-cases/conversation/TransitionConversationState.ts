// LAYER: Application
// Use case: validate and execute FSM state transitions.
// Encapsulates transition rules so the Interfaces layer never calls the repository directly.

import {
  canTransition,
  type FsmState,
  type ConversationState,
  type ConversationStateExpiryPrecondition,
  type ConversationStatePrecondition,
  type ConversationStateWriteResult,
  getFinancialExecutionClaim,
} from '../../../domain/entities/ConversationState';
import { InvalidStateTransitionError } from '../../../domain/errors/InvalidStateTransitionError';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TransitionConversationStateInput {
  userId: string;
  targetState: FsmState;
  payload?: Record<string, unknown> | null;
  expiresAt?: Date | null;
  expected?: ConversationStatePrecondition;
  claimId?: string;
}

interface StateExecutionStore {
  current: ConversationState;
  valid: boolean;
  controller: AbortController;
}

export class TransitionConversationState {
  private readonly storage = new AsyncLocalStorage<StateExecutionStore>();
  private readonly activeStores = new Map<string, Set<StateExecutionStore>>();

  constructor(private readonly conversationRepo: IConversationStateRepository) {}

  async runWithState<T>(state: ConversationState, operation: () => Promise<T>): Promise<T> {
    const existing = this.storage.getStore();
    if (existing?.valid === true && existing.current.userId === state.userId) {
      return operation();
    }
    const store: StateExecutionStore = {
      current: state,
      valid: true,
      controller: new AbortController(),
    };
    const stores = this.activeStores.get(state.userId) ?? new Set<StateExecutionStore>();
    stores.add(store);
    this.activeStores.set(state.userId, stores);
    try {
      return await this.storage.run(store, operation);
    } finally {
      stores.delete(store);
      if (stores.size === 0) this.activeStores.delete(state.userId);
    }
  }

  async runForUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const state =
      (await this.conversationRepo.findByUserId(userId)) ??
      (await this.conversationRepo.create(userId));
    return this.runWithState(state, operation);
  }

  invalidateExecution(userId?: string): void {
    const stores = userId
      ? this.activeStores.get(userId)
      : new Set([this.storage.getStore()].filter((value): value is StateExecutionStore => !!value));
    for (const store of stores ?? []) {
      store.valid = false;
      store.controller.abort();
    }
  }

  currentState(userId: string): ConversationState | null {
    const store = this.storage.getStore();
    return store?.valid === true && store.current.userId === userId ? store.current : null;
  }

  signal(userId: string): AbortSignal | null {
    const store = this.storage.getStore();
    return store?.current.userId === userId ? store.controller.signal : null;
  }

  assertExecutionIsValid(userId: string): void {
    const store = this.storage.getStore();
    if (
      !store ||
      !store.valid ||
      store.controller.signal.aborted ||
      store.current.userId !== userId
    ) {
      throw new StaleConversationStateError({ status: 'stale' });
    }
  }

  async assertCanStartFinancialEffect(userId: string, claimId: string): Promise<void> {
    this.assertExecutionIsValid(userId);
    const store = this.storage.getStore()!;
    const persisted = await this.conversationRepo.findByUserId(userId);
    if (getFinancialExecutionClaim(persisted?.statePayload ?? null)?.claimId !== claimId) {
      store.valid = false;
      store.controller.abort();
      throw new StaleConversationStateError({ status: 'operation_in_progress' });
    }
  }

  async finalizeClaim(
    input: Omit<TransitionConversationStateInput, 'expected'> & { claimId: string },
  ) {
    const current = await this.conversationRepo.findByUserId(input.userId);
    if (!current || getFinancialExecutionClaim(current.statePayload)?.claimId !== input.claimId) {
      throw new StaleConversationStateError({
        status: current ? 'operation_in_progress' : 'missing',
      });
    }
    return this.execute({
      ...input,
      expected: this.precondition(current, 'any'),
    });
  }

  async execute(input: TransitionConversationStateInput): Promise<ConversationStateWriteResult> {
    const store = this.storage.getStore();
    if (store?.current.userId === input.userId && !store.valid) {
      throw new StaleConversationStateError({ status: 'stale' });
    }
    const contextState =
      store?.valid === true && store.current.userId === input.userId ? store.current : null;
    const expected =
      input.expected ??
      (contextState
        ? this.precondition(contextState, this.defaultExpiryPrecondition(contextState))
        : null);
    if (!expected) {
      throw new Error('Conversation state mutation requires an observed state precondition');
    }
    const fromState = expected.currentState as FsmState;

    if (!canTransition(fromState, input.targetState)) {
      throw new InvalidStateTransitionError(fromState, input.targetState);
    }

    const result = await this.conversationRepo.transition({
      userId: input.userId,
      expected,
      nextState: input.targetState,
      payload: input.payload ?? null,
      expiresAt: input.expiresAt ?? null,
      ...(input.claimId === undefined ? {} : { claimId: input.claimId }),
    });
    if (result.status === 'updated') {
      if (store && store.current.userId === input.userId) store.current = result.state;
      return result;
    }
    if (store) store.valid = false;
    throw new StaleConversationStateError(result);
  }

  precondition(
    state: ConversationState,
    expiry: ConversationStateExpiryPrecondition = 'any',
  ): ConversationStatePrecondition {
    return { revision: state.revision, currentState: state.currentState, expiry };
  }

  private defaultExpiryPrecondition(state: ConversationState): ConversationStateExpiryPrecondition {
    return state.expiresAt === null ? 'any' : 'unexpired';
  }
}

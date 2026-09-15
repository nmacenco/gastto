import { describe, expect, it, vi } from 'vitest';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import { ObserveSemanticRouting } from './ObserveSemanticRouting';
import { ProjectSemanticRouterInput } from './ProjectSemanticRouterInput';

const state: ConversationState = {
  userId: 'user-1',
  revision: '4',
  currentState: 'IDLE',
  statePayload: { privateField: 'not projected' },
  enteredAt: new Date('2026-09-14T10:00:00Z'),
  expiresAt: null,
  updatedAt: new Date('2026-09-14T10:00:00Z'),
};

function buildDeps() {
  return {
    policy: {
      admitsForObservation: vi.fn().mockReturnValue(true),
      resolve: vi.fn().mockReturnValue({ mode: 'shadow', cohortBucket: 1, sampleBucket: 2 }),
    },
    projector: new ProjectSemanticRouterInput(),
    router: {
      decide: vi.fn().mockResolvedValue({
        status: 'proposed',
        decision: { action: 'register_expense' },
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini-2024-07-18',
          promptVersion: 'semantic-openai-v1',
          contractVersion: 'semantic-contract-v1',
          latencyMs: 12,
          inputTokens: 10,
          outputTokens: 3,
        },
      }),
    },
    snapshotValidator: { execute: vi.fn().mockResolvedValue({ status: 'current', state }) },
    telemetry: { record: vi.fn() },
  };
}

describe('ProjectSemanticRouterInput', () => {
  it('projects only bounded IDLE/EXPENSE_RECEIVING context', () => {
    const result = new ProjectSemanticRouterInput().execute({
      rawMessage: 'Compra confirmada',
      conversationState: state,
    });
    expect(result).toMatchObject({
      status: 'supported',
      input: {
        rawMessage: 'Compra confirmada',
        state: 'IDLE',
        substep: null,
        context: { pendingQuestion: null, missingFields: [], expense: null, options: [] },
      },
    });
    expect(JSON.stringify(result)).not.toContain('privateField');
  });
});

describe('ObserveSemanticRouting', () => {
  it('records an allowed shadow proposal and performs no business effect', async () => {
    const deps = buildDeps();
    const observer = new ObserveSemanticRouting(deps);
    const result = await observer.execute({
      userId: 'user-1',
      externalMessageId: 'message-1',
      rawMessage: 'Compra confirmada',
      conversationState: state,
      deterministicDecision: { kind: 'expense_guidance' },
    });

    expect(result).toMatchObject({
      policyOutcome: 'allowed_shadow',
      deterministicDecision: 'expense_guidance',
      proposedAction: 'register_expense',
    });
    expect(deps.router.decide).toHaveBeenCalledTimes(1);
    expect(deps.telemetry.record).toHaveBeenCalledWith(result);
  });

  it.each([
    { kind: 'typed_callback' as const },
    { kind: 'sensitive_command' as const, command: 'undo' as const },
  ])(
    'skips the router for deterministic bypass $kind and tolerates telemetry failure',
    async (decision) => {
      const deps = buildDeps();
      deps.policy.resolve.mockReturnValue({ mode: 'off', reason: 'deterministic_bypass' });
      deps.telemetry.record.mockImplementation(() => {
        throw new Error('telemetry unavailable');
      });
      const result = await new ObserveSemanticRouting(deps).execute({
        userId: 'user-1',
        externalMessageId: 'message-1',
        rawMessage: '',
        conversationState: state,
        deterministicDecision: decision,
      });
      expect(result.policyOutcome).toBe('deterministic_bypass');
      expect(deps.router.decide).not.toHaveBeenCalled();
    },
  );

  it('rejects a proposal after the captured snapshot becomes stale', async () => {
    const deps = buildDeps();
    deps.snapshotValidator.execute.mockResolvedValue({ status: 'stale' });
    const result = await new ObserveSemanticRouting(deps).execute({
      userId: 'user-1',
      externalMessageId: 'message-1',
      rawMessage: 'Compra confirmada',
      conversationState: state,
      deterministicDecision: { kind: 'expense_guidance' },
    });
    expect(result).toMatchObject({ policyOutcome: 'stale_context', errorCode: 'STALE_CONTEXT' });
  });

  it('maps router failure without suppressing the caller', async () => {
    const deps = buildDeps();
    deps.router.decide.mockRejectedValue(new Error('provider down'));
    const result = await new ObserveSemanticRouting(deps).execute({
      userId: 'user-1',
      externalMessageId: 'message-1',
      rawMessage: 'Compra confirmada',
      conversationState: state,
      deterministicDecision: { kind: 'expense_guidance' },
    });
    expect(result).toMatchObject({ policyOutcome: 'router_failure', errorCode: 'PROVIDER_ERROR' });
  });
});

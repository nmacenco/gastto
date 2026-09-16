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

    expect(result).toEqual({ status: 'deterministic', reason: 'shadow_only' });
    expect(deps.telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({
        policyOutcome: 'allowed_shadow',
        deterministicDecision: 'expense_guidance',
        proposedAction: 'register_expense',
      }),
    );
    expect(deps.router.decide).toHaveBeenCalledTimes(1);
  });

  it('returns one validated enabled expense action bound to the captured snapshot', async () => {
    const deps = buildDeps();
    deps.policy.resolve.mockReturnValue({ mode: 'enabled', cohortBucket: 1, sampleBucket: 2 });

    const result = await new ObserveSemanticRouting(deps).execute({
      userId: 'user-1',
      externalMessageId: 'message-1',
      rawMessage: 'Mercadona 16,55 EUR',
      conversationState: state,
      deterministicDecision: { kind: 'expense_guidance' },
    });

    expect(result).toEqual({
      status: 'expense_action',
      decision: { action: 'register_expense' },
      expected: { revision: '4', currentState: 'IDLE', expiry: 'unexpired' },
    });
    expect(deps.router.decide).toHaveBeenCalledOnce();
    expect(deps.snapshotValidator.execute).toHaveBeenCalledOnce();
    expect(deps.telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'enabled', policyOutcome: 'allowed_enabled' }),
    );
  });

  it.each([
    {
      currentState: 'EXPENSE_CLARIFYING' as const,
      statePayload: {
        _type: 'ExpenseClarificationState',
        missingField: 'moneda',
        partialExtracted: {
          monto: 16.55,
          moneda: null,
          categoriaRaw: 'Mercadona',
          subcategoriaRaw: null,
          fechaRaw: '2026-09-11',
          medioPago: null,
          confianzaCategoria: 'alta',
          confianzaSubcategoria: 'nula',
        },
        rawMessage: 'Mercadona 16,55',
      },
      rawMessage: 'euros',
      decision: { action: 'provide_missing_expense_data' as const },
    },
    {
      currentState: 'EXPENSE_REVIEW' as const,
      statePayload: {
        extracted: {
          monto: 16.55,
          moneda: 'EUR',
          categoriaRaw: 'Mercadona',
          subcategoriaRaw: null,
          fechaRaw: '2026-09-11',
          medioPago: null,
          confianzaCategoria: 'alta',
          confianzaSubcategoria: 'nula',
        },
        rawMessage: 'Mercadona 16,55 EUR',
        resolvedDate: '2026-09-11',
        resolvedCategory: null,
        resolvedCategoryId: null,
        categoryStatus: 'none',
        reviewBinding: {
          operationId: 'abcdefghijklmnopqrstuv',
          revision: 1,
          presentedAt: '2026-09-14T10:00:00.000Z',
        },
      },
      rawMessage: 'sí, pero cambia el importe a 25',
      decision: { action: 'correct_expense' as const },
    },
    {
      currentState: 'EXPENSE_REVIEW' as const,
      statePayload: {
        extracted: {
          monto: 16.55,
          moneda: 'EUR',
          categoriaRaw: 'Mercadona',
          subcategoriaRaw: null,
          fechaRaw: '2026-09-11',
          medioPago: null,
          confianzaCategoria: 'alta',
          confianzaSubcategoria: 'nula',
        },
        rawMessage: 'Mercadona 16,55 EUR',
        resolvedDate: '2026-09-11',
        resolvedCategory: null,
        resolvedCategoryId: null,
        categoryStatus: 'none',
        reviewBinding: {
          operationId: 'abcdefghijklmnopqrstuv',
          revision: 1,
          presentedAt: '2026-09-14T10:00:00.000Z',
        },
      },
      rawMessage: 'Taxi 12 EUR',
      decision: { action: 'register_expense' as const },
    },
  ])(
    'returns enabled $decision.action for $currentState with the state-bound precondition',
    async ({ currentState, statePayload, rawMessage, decision }) => {
      const deps = buildDeps();
      const statefulState: ConversationState = {
        ...state,
        currentState,
        statePayload,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      };
      deps.policy.resolve.mockReturnValue({ mode: 'enabled', cohortBucket: 1, sampleBucket: 2 });
      deps.router.decide.mockResolvedValue({
        status: 'proposed',
        decision,
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini-2024-07-18',
          promptVersion: 'semantic-openai-v1',
          contractVersion: 'semantic-contract-v1',
          latencyMs: 12,
          inputTokens: 10,
          outputTokens: 3,
        },
      });
      deps.snapshotValidator.execute.mockResolvedValue({ status: 'current', state: statefulState });

      await expect(
        new ObserveSemanticRouting(deps).execute({
          userId: 'user-1',
          externalMessageId: 'message-1',
          rawMessage,
          conversationState: statefulState,
          deterministicDecision: { kind: 'fsm_handler' },
        }),
      ).resolves.toEqual({
        status: 'expense_action',
        decision,
        expected: { revision: '4', currentState, expiry: 'unexpired' },
      });
      expect(deps.router.decide).toHaveBeenCalledOnce();
      expect(deps.telemetry.record).toHaveBeenCalledWith(
        expect.objectContaining({
          policyOutcome: 'allowed_enabled',
          proposedAction: decision.action,
        }),
      );
    },
  );

  it('keeps an enabled mixed intent as controlled clarification without an expense action', async () => {
    const deps = buildDeps();
    deps.policy.resolve.mockReturnValue({ mode: 'enabled', cohortBucket: 1, sampleBucket: 2 });
    deps.router.decide.mockResolvedValue({
      status: 'proposed',
      decision: { action: 'request_clarification', reason: 'mixed_intents' },
      metadata: {
        provider: 'openai',
        model: 'gpt-4o-mini-2024-07-18',
        promptVersion: 'semantic-openai-v1',
        contractVersion: 'semantic-contract-v1',
        latencyMs: 12,
        inputTokens: 10,
        outputTokens: 3,
      },
    });

    await expect(
      new ObserveSemanticRouting(deps).execute({
        userId: 'user-1',
        externalMessageId: 'message-1',
        rawMessage: 'sí, y agrega también otro gasto',
        conversationState: state,
        deterministicDecision: { kind: 'fsm_handler' },
      }),
    ).resolves.toEqual({ status: 'clarification', reason: 'mixed_intents' });
  });

  it('fails closed with controlled clarification when enabled output is stale', async () => {
    const deps = buildDeps();
    deps.policy.resolve.mockReturnValue({ mode: 'enabled', cohortBucket: 1, sampleBucket: 2 });
    deps.snapshotValidator.execute.mockResolvedValue({ status: 'stale' });

    const result = await new ObserveSemanticRouting(deps).execute({
      userId: 'user-1',
      externalMessageId: 'message-1',
      rawMessage: 'Mercadona 16,55 EUR',
      conversationState: state,
      deterministicDecision: { kind: 'expense_guidance' },
    });

    expect(result).toEqual({ status: 'clarification', reason: 'unsupported_action' });
    expect(deps.telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ policyOutcome: 'stale_context', errorCode: 'STALE_CONTEXT' }),
    );
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
      expect(result).toEqual({ status: 'deterministic', reason: 'deterministic_bypass' });
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
    expect(result).toEqual({ status: 'deterministic', reason: 'shadow_only' });
    expect(deps.telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ policyOutcome: 'stale_context', errorCode: 'STALE_CONTEXT' }),
    );
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
    expect(result).toEqual({ status: 'deterministic', reason: 'shadow_only' });
    expect(deps.telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ policyOutcome: 'router_failure', errorCode: 'PROVIDER_ERROR' }),
    );
  });

  it('records malformed provider output as INVALID_OUTPUT without exposing its body', async () => {
    const deps = buildDeps();
    deps.router.decide.mockResolvedValue({
      status: 'proposed',
      decision: { action: 'register_expense' },
      providerBody: 'raw private response',
    });

    const result = await new ObserveSemanticRouting(deps).execute({
      userId: 'user-1',
      externalMessageId: 'message-1',
      rawMessage: 'Compra confirmada',
      conversationState: state,
      deterministicDecision: { kind: 'expense_guidance' },
    });

    expect(result).toEqual({ status: 'deterministic', reason: 'shadow_only' });
    expect(deps.telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ policyOutcome: 'router_failure', errorCode: 'INVALID_OUTPUT' }),
    );
    expect(deps.telemetry.record).toHaveBeenCalledOnce();
    expect(JSON.stringify(deps.telemetry.record.mock.calls)).not.toContain('providerBody');
  });

  it.each([
    ['MODEL_REFUSAL', 'MODEL_REFUSAL'],
    ['TIMEOUT', 'TIMEOUT'],
    ['INVALID_OUTPUT', 'INVALID_OUTPUT'],
    ['PROVIDER_ERROR', 'PROVIDER_ERROR'],
  ] as const)('records one sanitized failed outcome for %s', async (_name, code) => {
    const deps = buildDeps();
    deps.router.decide.mockResolvedValue({
      status: 'failed',
      code,
      metadata: {
        provider: 'openai',
        model: 'gpt-4o-mini-2024-07-18',
        promptVersion: 'semantic-openai-v1',
        contractVersion: 'semantic-contract-v1',
        latencyMs: 12,
        inputTokens: 10,
        outputTokens: 3,
      },
    });

    const result = await new ObserveSemanticRouting(deps).execute({
      userId: 'user-1',
      externalMessageId: 'message-1',
      rawMessage: 'Compra confirmada',
      conversationState: state,
      deterministicDecision: { kind: 'expense_guidance' },
    });

    expect(result).toEqual({ status: 'deterministic', reason: 'shadow_only' });
    expect(deps.telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ policyOutcome: 'router_failure', errorCode: code }),
    );
    expect(deps.snapshotValidator.execute).toHaveBeenCalledTimes(1);
    expect(deps.telemetry.record).toHaveBeenCalledOnce();
  });

  it('records forbidden proposals without exposing authorization evidence', async () => {
    const deps = buildDeps();
    deps.router.decide.mockResolvedValue({
      status: 'proposed',
      decision: { action: 'request_save_retry' },
      metadata: {
        provider: 'openai',
        model: 'gpt-4o-mini-2024-07-18',
        promptVersion: 'semantic-openai-v1',
        contractVersion: 'semantic-contract-v1',
        latencyMs: 12,
        inputTokens: 10,
        outputTokens: 3,
      },
    });

    const result = await new ObserveSemanticRouting(deps).execute({
      userId: 'user-private',
      externalMessageId: 'message-private',
      rawMessage: 'guardalo',
      conversationState: state,
      deterministicDecision: { kind: 'fsm_handler' },
    });

    expect(result).toEqual({ status: 'deterministic', reason: 'shadow_only' });
    expect(deps.telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ policyOutcome: 'forbidden_action' }),
    );
    expect(JSON.stringify(result)).not.toContain('user-private');
    expect(JSON.stringify(result)).not.toContain('message-private');
  });

  it.each([
    [{ mode: 'off' as const, reason: 'state_off' as const }, 'disabled'],
    [{ mode: 'off' as const, reason: 'not_sampled' as const }, 'not_sampled'],
  ])(
    'records skipped outcomes without projecting or calling the router',
    async (resolution, outcome) => {
      const deps = buildDeps();
      deps.policy.resolve.mockReturnValue(resolution);
      const execute = vi.spyOn(deps.projector, 'execute');

      const result = await new ObserveSemanticRouting(deps).execute({
        userId: 'user-1',
        externalMessageId: 'message-1',
        rawMessage: 'hola',
        conversationState: state,
        deterministicDecision: { kind: 'fsm_handler' },
      });

      expect(result).toEqual({ status: 'deterministic', reason: resolution.reason });
      expect(deps.telemetry.record).toHaveBeenCalledWith(
        expect.objectContaining({ policyOutcome: outcome }),
      );
      expect(execute).not.toHaveBeenCalled();
      expect(deps.router.decide).not.toHaveBeenCalled();
      expect(deps.telemetry.record).toHaveBeenCalledOnce();
    },
  );

  it('records invalid state context once and never calls the router', async () => {
    const deps = buildDeps();
    const invalidReview: ConversationState = {
      ...state,
      currentState: 'EXPENSE_REVIEW',
      statePayload: { legacy: true },
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    };
    const result = await new ObserveSemanticRouting(deps).execute({
      userId: 'user-1',
      externalMessageId: 'message-1',
      rawMessage: 'corregir',
      conversationState: invalidReview,
      deterministicDecision: { kind: 'fsm_handler' },
    });

    expect(result).toEqual({ status: 'deterministic', reason: 'shadow_only' });
    expect(deps.telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({
        policyOutcome: 'invalid_context',
        errorCode: 'INVALID_STATE_CONTEXT',
      }),
    );
    expect(deps.router.decide).not.toHaveBeenCalled();
    expect(deps.telemetry.record).toHaveBeenCalledOnce();
  });

  it('uses the validated runtime substep for policy resolution and telemetry', async () => {
    const deps = buildDeps();
    const idkState: ConversationState = {
      ...state,
      currentState: 'ONBOARDING_SHEET',
      statePayload: {
        selectedFileId: 'file-1',
        sheetList: [{ name: 'Gastos', index: 0 }],
        step: 'idk',
      },
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    };
    await new ObserveSemanticRouting(deps).execute({
      userId: 'user-1',
      externalMessageId: 'message-1',
      rawMessage: 'la primera',
      conversationState: idkState,
      deterministicDecision: { kind: 'fsm_handler' },
    });

    expect(deps.policy.resolve).toHaveBeenCalledWith(expect.objectContaining({ substep: 'idk' }));
    expect(deps.telemetry.record).toHaveBeenCalledWith(expect.objectContaining({ substep: 'idk' }));
  });
});

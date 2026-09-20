import { describe, expect, it, vi } from 'vitest';
import { PinoSemanticRoutingTelemetry } from './PinoSemanticRoutingTelemetry';

describe('PinoSemanticRoutingTelemetry', () => {
  it('records only the supplied metadata observation', () => {
    const info = vi.fn();
    const adapter = new PinoSemanticRoutingTelemetry({ info } as never);
    const observation = {
      event: 'semantic_router_observation' as const,
      mode: 'shadow' as const,
      state: 'IDLE' as const,
      substep: null,
      deterministicDecision: 'expense_guidance' as const,
      proposedAction: 'register_expense' as const,
      policyOutcome: 'allowed_shadow' as const,
      provider: 'openai',
      model: 'gpt-4o-mini-2024-07-18',
      promptVersion: 'semantic-openai-v3',
      contractVersion: 'semantic-contract-v2',
      policyVersion: 'semantic-policy-v3',
      latencyMs: 10,
      errorCode: null,
    };

    adapter.record(observation);

    expect(info).toHaveBeenCalledWith(observation);
    expect(JSON.stringify(info.mock.calls)).not.toContain('rawMessage');
    expect(JSON.stringify(info.mock.calls)).not.toContain('user-');
  });

  it('rejects observations carrying fields outside the metadata schema', () => {
    const info = vi.fn();
    const adapter = new PinoSemanticRoutingTelemetry({ info } as never);

    adapter.record({
      event: 'semantic_router_observation',
      mode: 'shadow',
      state: 'IDLE',
      substep: null,
      deterministicDecision: 'fsm_handler',
      proposedAction: null,
      policyOutcome: 'router_failure',
      provider: null,
      model: null,
      promptVersion: null,
      contractVersion: 'semantic-contract-v2',
      policyVersion: 'semantic-policy-v3',
      latencyMs: null,
      errorCode: 'PROVIDER_ERROR',
      rawMessage: 'private text',
    } as never);

    expect(info).not.toHaveBeenCalled();
  });

  it('logs a metadata-only error and remains non-fatal when the telemetry sink throws', () => {
    const info = vi.fn(() => {
      throw new Error('sink body with private data');
    });
    const error = vi.fn();
    const adapter = new PinoSemanticRoutingTelemetry({ info, error } as never);

    expect(() =>
      adapter.record({
        event: 'semantic_router_observation',
        mode: 'shadow',
        state: 'IDLE',
        substep: null,
        deterministicDecision: 'expense_guidance',
        proposedAction: null,
        policyOutcome: 'router_failure',
        provider: null,
        model: null,
        promptVersion: null,
        contractVersion: 'semantic-contract-v2',
        policyVersion: 'semantic-policy-v3',
        latencyMs: null,
        errorCode: 'PROVIDER_ERROR',
      }),
    ).not.toThrow();
    expect(error).toHaveBeenCalledWith({
      msg: 'Failed to record semantic routing telemetry',
      endpoint: 'PinoSemanticRoutingTelemetry.record',
      code: 'SEMANTIC_TELEMETRY_FAILED',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('private data');
  });

  it('records strict aggregate rollout events without identity-bearing fields', () => {
    const info = vi.fn();
    const adapter = new PinoSemanticRoutingTelemetry({ info } as never);
    const observation = {
      schemaVersion: 'semantic-rollout-observation-v1' as const,
      evidenceKind: 'task_completed' as const,
      occurredAt: '2026-09-19T12:00:00.000Z',
      releaseId: 'candidate-1',
      deploymentVersion: 'deployment-v1',
      environment: 'staging' as const,
      mode: 'enabled' as const,
      cohort: 'candidate' as const,
      state: 'EXPENSE_REVIEW',
      substep: null,
      capability: 'expense' as const,
      outcomeCode: 'saved',
      provider: null,
      model: null,
      promptVersion: null,
      contractVersion: 'semantic-contract-v2',
      policyVersion: 'semantic-policy-v3',
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
    };

    adapter.recordRollout(observation);
    expect(info).toHaveBeenCalledWith({ event: 'semantic_rollout_observation', ...observation });
    adapter.recordRollout({ ...observation, userId: 'private' } as never);
    expect(info).toHaveBeenCalledTimes(1);
  });
});

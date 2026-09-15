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
      promptVersion: 'semantic-openai-v1',
      contractVersion: 'semantic-contract-v1',
      policyVersion: 'semantic-policy-v1',
      latencyMs: 10,
      errorCode: null,
    };

    adapter.record(observation);

    expect(info).toHaveBeenCalledWith(observation);
    expect(JSON.stringify(info.mock.calls)).not.toContain('rawMessage');
    expect(JSON.stringify(info.mock.calls)).not.toContain('user-');
  });
});

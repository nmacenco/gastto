import { describe, expect, it } from 'vitest';
import { Sha256SemanticRoutingPolicy, type SemanticRoutingConfig } from './runtime-policy';

const config: SemanticRoutingConfig = {
  stateModes: { IDLE: 'shadow', EXPENSE_RECEIVING: 'enabled' },
  cohortPercent: 100,
  shadowSamplePercent: 100,
  cohortSeed: 'test-seed',
};

describe('Sha256SemanticRoutingPolicy', () => {
  it('selects stable SHA-256 buckets for an admitted shadow message', () => {
    const policy = new Sha256SemanticRoutingPolicy(config);
    const input = {
      userId: 'user-1',
      externalMessageId: 'message-1',
      state: 'IDLE' as const,
      substep: null,
      messageKind: 'free_text' as const,
      providerAvailable: true,
    };

    expect(policy.admitsForObservation(input.userId)).toBe(true);
    expect(policy.resolve(input)).toEqual(policy.resolve(input));
    expect(policy.resolve(input)).toMatchObject({ mode: 'shadow' });
  });

  it('defaults unconfigured states to off and bypasses typed or sensitive input', () => {
    const policy = new Sha256SemanticRoutingPolicy(config);
    expect(
      policy.resolve({
        userId: 'user-1',
        externalMessageId: 'message-1',
        state: 'EXPENSE_REVIEW',
        substep: null,
        messageKind: 'free_text',
        providerAvailable: true,
      }),
    ).toEqual({ mode: 'off', reason: 'state_off' });
    for (const messageKind of ['typed_callback', 'sensitive_command'] as const) {
      expect(
        policy.resolve({
          userId: 'user-1',
          externalMessageId: 'message-1',
          state: 'IDLE',
          substep: null,
          messageKind,
          providerAvailable: true,
        }),
      ).toEqual({ mode: 'off', reason: 'deterministic_bypass' });
    }
  });

  it('fails closed for unavailable providers, enabled mode, and unsupported substeps', () => {
    const policy = new Sha256SemanticRoutingPolicy(config);
    const base = {
      userId: 'user-1',
      externalMessageId: 'message-1',
      substep: null,
      messageKind: 'free_text' as const,
      providerAvailable: true,
    };
    expect(policy.resolve({ ...base, state: 'IDLE', providerAvailable: false })).toEqual({
      mode: 'unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(policy.resolve({ ...base, state: 'EXPENSE_RECEIVING' })).toEqual({
      mode: 'unavailable',
      code: 'ENABLED_CAPABILITY_UNAVAILABLE',
    });
    expect(policy.resolve({ ...base, state: 'IDLE', substep: 'unknown' })).toEqual({
      mode: 'unavailable',
      code: 'UNSUPPORTED_CONFIGURATION',
    });
  });

  it('does not admit users when all states or capacity are off', () => {
    expect(
      new Sha256SemanticRoutingPolicy({ ...config, stateModes: {} }).admitsForObservation('u'),
    ).toBe(false);
    expect(
      new Sha256SemanticRoutingPolicy({ ...config, cohortPercent: 0 }).admitsForObservation('u'),
    ).toBe(false);
  });
});

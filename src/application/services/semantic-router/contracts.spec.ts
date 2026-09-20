import { describe, expect, it } from 'vitest';
import {
  ConversationDecisionSchema,
  SemanticRouterInputSchema,
  assessSemanticProposal,
  CONTRACT_VERSION,
} from './contracts';
import { buildSemanticInput } from '../../../__tests__/factories/semantic-router';
import { FSM_STATES } from '../../../domain/entities/ConversationState';
import { STATE_ACTION_POLICY } from './policy';

describe('semantic trust boundaries', () => {
  it.each([
    { action: 'confirm' },
    { action: 'register_expense', sourceText: 'invented' },
    { action: 'select_option', userReference: '' },
    { action: 'select_option', id: 'invented' },
    { action: 'request_clarification', reason: 'other' },
    { action: 'request_clarification' },
  ])('rejects invalid decision %j', (value) => {
    expect(ConversationDecisionSchema.safeParse(value).success).toBe(false);
  });

  it('rejects action expansion, unknown substeps and arbitrary payloads', () => {
    const input = buildSemanticInput();
    expect(
      SemanticRouterInputSchema.safeParse({ ...input, allowedActions: ['correct_expense'] })
        .success,
    ).toBe(false);
    expect(SemanticRouterInputSchema.safeParse({ ...input, substep: 'unrecognized' }).success).toBe(
      false,
    );
    expect(SemanticRouterInputSchema.safeParse({ ...input, substep: '__proto__' }).success).toBe(
      false,
    );
    expect(SemanticRouterInputSchema.safeParse({ ...input, statePayload: {} }).success).toBe(false);
    expect(SemanticRouterInputSchema.safeParse({ ...input, state: 'EXPENSE_SAVING' }).success).toBe(
      false,
    );
  });

  it('rejects excessive input, duplicate positions, invalid currency/date and nonfinite amount', () => {
    const input = buildSemanticInput();
    expect(
      SemanticRouterInputSchema.safeParse({ ...input, rawMessage: 'a'.repeat(8001) }).success,
    ).toBe(false);
    expect(
      SemanticRouterInputSchema.safeParse({
        ...input,
        context: {
          ...input.context,
          options: [
            { position: 1, label: 'A' },
            { position: 1, label: 'B' },
          ],
        },
      }).success,
    ).toBe(false);
    for (const expense of [
      { amount: Infinity, currency: 'EUR', date: null, concept: null },
      { amount: 1, currency: 'XXX', date: null, concept: null },
      { amount: 1, currency: 'EUR', date: '2026-02-30', concept: null },
    ]) {
      expect(
        SemanticRouterInputSchema.safeParse({ ...input, context: { ...input.context, expense } })
          .success,
      ).toBe(false);
    }
  });

  it('distinguishes valid forbidden output from malformed output and caller widening', () => {
    const input = buildSemanticInput();
    const result = {
      status: 'proposed' as const,
      decision: { action: 'correct_expense' as const },
      metadata: {
        provider: 'offline',
        model: 'fixture',
        promptVersion: 'none',
        contractVersion: CONTRACT_VERSION,
        latencyMs: 0,
        inputTokens: null,
        outputTokens: null,
      },
    };
    expect(assessSemanticProposal(input, result).status).toBe('forbidden_action');
    expect(
      assessSemanticProposal({ ...input, allowedActions: ['correct_expense'] }, result),
    ).toEqual({ status: 'router_failure', code: 'INVALID_INPUT' });
    const malformed = { ...result, decision: { ...result.decision, extra: 'untrusted' } };
    expect(assessSemanticProposal(input, malformed)).toEqual({
      status: 'router_failure',
      code: 'INVALID_OUTPUT',
    });
  });

  it('accounts for every domain state without introducing semantic confirmation', () => {
    expect(Object.keys(STATE_ACTION_POLICY).sort()).toEqual([...FSM_STATES].sort());
    expect(JSON.stringify(STATE_ACTION_POLICY)).not.toContain('confirm_current_step');
  });
});

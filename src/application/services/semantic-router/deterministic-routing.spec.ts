import { describe, expect, it } from 'vitest';
import { ClassifyFreeTextExpenseIntent } from '../../use-cases/conversation/ClassifyFreeTextExpenseIntent';
import { CurrentDeterministicRoutingPolicy } from './deterministic-routing';

describe('CurrentDeterministicRoutingPolicy', () => {
  const policy = new CurrentDeterministicRoutingPolicy(new ClassifyFreeTextExpenseIntent());

  it.each([
    ['Almuerzo 12 euros', 'fsm_handler'],
    ['hola, cómo estás', 'expense_guidance'],
    ['a'.repeat(501), 'fsm_handler'],
    ['cancelar', 'fsm_handler'],
  ])('preserves IDLE lexical routing for %s', (rawMessage, kind) => {
    expect(policy.decide({ state: 'IDLE', rawMessage, hasCallback: false }).kind).toBe(kind);
  });

  it('bypasses typed callbacks and exact financial authorization commands', () => {
    expect(policy.decide({ state: 'EXPENSE_REVIEW', rawMessage: '', hasCallback: true })).toEqual({
      kind: 'typed_callback',
    });
    expect(policy.decide({ state: 'IDLE', rawMessage: 'deshacer', hasCallback: false })).toEqual({
      kind: 'sensitive_command',
      command: 'undo',
    });
    expect(
      policy.decide({ state: 'EXPENSE_REVIEW', rawMessage: 'sí', hasCallback: false }),
    ).toEqual({
      kind: 'sensitive_command',
      command: 'save',
    });
    expect(
      policy.decide({
        state: 'EXPENSE_SAVING_RETRY',
        rawMessage: 'reintentar',
        hasCallback: false,
      }),
    ).toEqual({ kind: 'sensitive_command', command: 'retry' });
  });
});

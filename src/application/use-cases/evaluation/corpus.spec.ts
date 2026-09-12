import { describe, it, expect } from 'vitest';
import corpus from '../../../../evals/semantic-router/corpus.json';
import { STATE_ACTION_POLICY } from '../../services/semantic-router/policy';
import { actionSchema } from '../../services/semantic-router/contracts';
import { EvaluationDatasetSchema } from './contracts';
import { caseKind } from './EvaluateSemanticRouter';

describe('frozen evaluation corpus contracts', () => {
  it('covers each eligible scope and all allowed/forbidden action pairs with explicit protocol stimuli', () => {
    const data = EvaluationDatasetSchema.parse(corpus);
    expect(data.cases).toHaveLength(200);
    expect(data.cases.filter((c) => c.split === 'held_out')).toHaveLength(25);
    for (const [state, steps] of Object.entries(STATE_ACTION_POLICY)) {
      for (const [step, allowed] of Object.entries(steps)) {
        const scope = data.cases.filter(
          (c) => c.input.state === state && (c.input.substep ?? 'default') === step,
        );
        expect(scope.some((c) => caseKind(c) === 'language')).toBe(true);
        for (const action of actionSchema.options) {
          const c = scope.find(
            (c) => c.tags.includes('matrix') && c.acceptedDecisions[0]?.action === action,
          );
          expect(c?.expectedAssessment).toBe(
            allowed.includes(action) ? 'allowed' : 'forbidden_action',
          );
        }
      }
    }
    expect(data.provenance?.independentHumanReview).toBe('pending');
    expect(data.provenance?.heldOutStatus).toBe('frozen-before-candidate-evaluation');
  });
  it('rejects family leakage, normalized-message leakage, missing families and inverted forbidden labels', () => {
    const fresh = () => EvaluationDatasetSchema.parse(corpus);
    let data = fresh();
    data.cases.find((c) => c.split === 'held_out')!.family = data.cases[0]!.family;
    expect(EvaluationDatasetSchema.safeParse(data).success).toBe(false);
    data = fresh();
    data.cases.find((c) => c.split === 'held_out')!.input.rawMessage =
      data.cases[0]!.input.rawMessage.toUpperCase().replace(/\n/g, '  ');
    expect(EvaluationDatasetSchema.safeParse(data).success).toBe(false);
    data = fresh();
    delete data.cases[0]!.family;
    expect(EvaluationDatasetSchema.safeParse(data).success).toBe(false);
    data = fresh();
    data.cases[0]!.expectedAssessment = 'forbidden_action';
    expect(EvaluationDatasetSchema.safeParse(data).success).toBe(false);
  });
  it('retains the exact bank regression and separates its family from held-out compositions', () => {
    const data = EvaluationDatasetSchema.parse(corpus),
      original = data.cases.find((c) => c.id === 'bank-notification')!;
    expect(original.input.rawMessage).toBe(
      'Fecha: 11 sept 2026, 21:09\nComercio: Mercadona\nImporte: 16,55\u00a0€\nTarjeta: CREDITO SANTANDER\nNombre: Mercadona\nTransacción: Mercadona',
    );
    expect(original.acceptedDecisions).toEqual([{ action: 'register_expense' }]);
    expect(original.mustNotAuthorize).toContain('save');
    expect(
      data.cases
        .filter((c) => c.family === original.family)
        .every((c) => c.split === 'development'),
    ).toBe(true);
    expect(
      data.cases.filter((c) => c.split === 'held_out' && c.tags.includes('bank')).length,
    ).toBeGreaterThan(5);
  });
});

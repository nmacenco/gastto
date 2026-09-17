import { describe, it, expect } from 'vitest';
import corpus from '../../../../evals/semantic-router/corpus.json';
import { STATE_ACTION_POLICY } from '../../services/semantic-router/policy';
import { actionSchema } from '../../services/semantic-router/contracts';
import { EvaluationDatasetSchema } from './contracts';
import { caseKind } from './EvaluateSemanticRouter';

describe('frozen evaluation corpus contracts', () => {
  it('covers each eligible scope and all allowed/forbidden action pairs with explicit protocol stimuli', () => {
    const data = EvaluationDatasetSchema.parse(corpus);
    expect(data.cases).toHaveLength(229);
    expect(data.cases.filter((c) => c.split === 'held_out')).toHaveLength(33);
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
  it('covers stateful expense-flow families in both independently split cohorts', () => {
    const data = EvaluationDatasetSchema.parse(corpus);
    for (const split of ['development', 'held_out'] as const) {
      const phase = data.cases.filter((c) => c.split === split && c.tags.includes('phase3'));
      for (const tag of [
        'short-reply',
        'bank',
        'correction',
        'new-expense',
        'negation',
        'mixed-intents',
        'unrelated',
        'prompt-injection',
      ]) {
        expect(
          phase.some((c) => c.tags.includes(tag)),
          `${split}/${tag}`,
        ).toBe(true);
      }
    }
    expect(
      data.cases.some((c) => c.tags.includes('legacy-state') && c.split === 'development'),
    ).toBe(true);
    expect(
      data.cases.some(
        (c) =>
          c.tags.includes('phase3') &&
          c.tags.includes('failure') &&
          c.expectedAssessment === 'router_failure',
      ),
    ).toBe(true);
  });
  it('covers effect-free file/default, sheet/default and sheet/idk resolution outcomes', () => {
    const data = EvaluationDatasetSchema.parse(corpus);
    const optionCases = data.cases.filter((c) => c.tags.includes('option-resolution'));
    expect(optionCases).toHaveLength(9);
    expect(
      new Set(optionCases.map((c) => `${c.input.state}/${c.input.substep ?? 'default'}`)),
    ).toEqual(
      new Set(['ONBOARDING_FILE/default', 'ONBOARDING_SHEET/default', 'ONBOARDING_SHEET/idk']),
    );
    expect(new Set(optionCases.map((c) => c.optionResolution?.expectedResult.status))).toEqual(
      new Set(['resolved', 'ambiguous', 'not_found', 'stale']),
    );
  });
});

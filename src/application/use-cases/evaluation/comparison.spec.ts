import { describe, it, expect, vi } from 'vitest';
import {
  buildSemanticDataset,
  buildProposedRouterResult,
} from '../../../__tests__/factories/semantic-router';
import type {
  SemanticRouterPort,
  SemanticRouterResult,
} from '../../../domain/ports/SemanticRouterPort';
import { EvaluateSemanticRouter } from './EvaluateSemanticRouter';
import { observeLexicalBaseline } from './observeLexicalBaseline';
import { wilsonInterval } from './statistics';

const settings = {
  model: 'gpt-4o-mini-2024-07-18',
  timeoutMs: 10000,
  maxOutputTokens: 256,
  maxCases: 4,
  concurrency: 1 as const,
  maxRetries: 0 as const,
};
function fourCases() {
  const dataset = buildSemanticDataset(),
    base = dataset.cases[0]!;
  dataset.cases = ['ambiguous-a', 'ambiguous-b', 'expense-a', 'expense-b'].map((id, index) => ({
    ...structuredClone(base),
    id,
    input: {
      ...structuredClone(base.input),
      rawMessage: index < 2 ? '¿Quizá era otro gasto?' : 'Compré pan 3 EUR',
    },
    acceptedDecisions:
      index < 2
        ? [{ action: 'request_clarification' as const, reason: 'ambiguous_intent' as const }]
        : [{ action: 'register_expense' as const }],
    expectedHandling: index < 2 ? ('clarify' as const) : ('semantic_proposal' as const),
  }));
  return dataset;
}
function routerFor(results: SemanticRouterResult[]) {
  const queue = [...results];
  return {
    decide: vi.fn<SemanticRouterPort['decide']>(() => {
      const result = queue.shift();
      if (!result) throw new Error('UNEXPECTED_CALL');
      return Promise.resolve(result);
    }),
  } satisfies SemanticRouterPort;
}
const expense = () => buildProposedRouterResult({ action: 'register_expense' });
const clarify = () =>
  buildProposedRouterResult({ action: 'request_clarification', reason: 'ambiguous_intent' });
describe('comparative semantic reporting', () => {
  it('computes a hand-labeled 1/1/1/1 confusion matrix and comparable denominators', async () => {
    const router = routerFor([clarify(), expense(), clarify(), expense()]);
    const report = await new EvaluateSemanticRouter().execute({
      mode: 'live',
      executionSettings: settings,
      dataset: fourCases(),
      router,
      baselineObserver: observeLexicalBaseline,
      sourceVersion: 'test-source',
    });
    expect(report.checks.clarificationConfusion).toEqual({
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 1,
      trueNegative: 1,
    });
    expect(report.checks.clarificationPrecision).toEqual({
      numerator: 1,
      denominator: 2,
      value: 0.5,
    });
    expect(report.checks.clarificationRecall.value).toBe(0.5);
    expect(report.checks.unnecessaryClarification.value).toBe(0.5);
    expect(report.checks.modelDecisionAgreement).toEqual({
      numerator: 2,
      denominator: 4,
      value: 0.5,
    });
    expect(report.checks.criticalCaseFailures.value).toBe(0.5);
    expect(report.byScope[0]!.language.confusion).toEqual(report.checks.clarificationConfusion);
    expect(report.baseline.comparisons[0]).toMatchObject({
      lexicalAgreement: { numerator: 2, denominator: 2 },
      candidateAgreement: { numerator: 1, denominator: 2 },
    });
    expect(report.baseline.comparisons[1]!.lexicalAgreement.value).toBeNull();
    expect(report.measurements.tokenUsage).toMatchObject({
      complete: true,
      inputTokens: 400,
      outputTokens: 40,
    });
    expect(report.measurements.latencyP95Ms).toBe(10);
    expect(report.uncertainty.decisionAgreement?.lower).toBeCloseTo(0.15, 2);
    expect(report.uncertainty.decisionAgreement?.upper).toBeCloseTo(0.85, 2);
    expect(report.measurements.cost).toBeNull();
    expect(report.measurements.taskCompletion).toBeNull();
    expect(report.measurements.falseAuthorization).toBeNull();
    expect(report.mismatchedCaseIds).toEqual(['ambiguous-b', 'expense-a']);
    expect(router.decide).toHaveBeenCalledTimes(4);
    for (const [input] of vi.mocked(router.decide).mock.calls)
      expect(input).not.toHaveProperty('acceptedDecisions');
  });
  it('keeps partial failures incomplete, missing usage null and reports observed usage separately', async () => {
    const missing: SemanticRouterResult = {
      ...expense(),
      metadata: { ...expense().metadata, inputTokens: null, outputTokens: null },
    };
    const failure: SemanticRouterResult = {
      status: 'failed',
      code: 'TIMEOUT',
      metadata: { ...expense().metadata, latencyMs: 100, inputTokens: null, outputTokens: null },
    };
    const report = await new EvaluateSemanticRouter().execute({
      mode: 'live',
      executionSettings: settings,
      dataset: fourCases(),
      router: routerFor([clarify(), failure, missing, expense()]),
      baselineObserver: observeLexicalBaseline,
      sourceVersion: 'test-source',
    });
    expect(report.complete).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.failureCounts).toEqual({ TIMEOUT: 1 });
    expect(report.measurements.tokenUsage).toMatchObject({
      complete: false,
      measuredCalls: 2,
      totalCalls: 4,
      inputTokens: null,
      outputTokens: null,
      observedInputTokens: 200,
    });
    expect(report.measurements.latencyP95Ms).toBe(100);
    expect(report.measurements.cost).toBeNull();
  });
  it('does not call providers with missing/unbounded settings or protocol stimuli in live mode', async () => {
    const router = routerFor([]),
      evaluator = new EvaluateSemanticRouter();
    const base = {
      mode: 'live' as const,
      dataset: fourCases(),
      router,
      baselineObserver: observeLexicalBaseline,
      sourceVersion: 'test',
    };
    await expect(evaluator.execute(base)).rejects.toThrow('INVALID_LIVE_SETTINGS');
    await expect(
      evaluator.execute({ ...base, executionSettings: { ...settings, maxCases: 1 } }),
    ).rejects.toThrow('INVALID_LIVE_SETTINGS');
    await expect(
      evaluator.execute({
        ...base,
        dataset: buildSemanticDataset(),
        executionSettings: { ...settings, maxCases: 100 },
      }),
    ).rejects.toThrow('INVALID_LIVE_SETTINGS');
    expect(router.decide).not.toHaveBeenCalled();
  });
  it('has null uncertainty with zero denominator and distinguishes offline evidence', async () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const report = await new EvaluateSemanticRouter().execute({
      dataset: fourCases(),
      router: routerFor([clarify(), expense(), clarify(), expense()]),
      baselineObserver: observeLexicalBaseline,
      sourceVersion: 'test',
    });
    expect(report.uncertainty.decisionAgreement).toBeNull();
    expect(report.checks.modelDecisionAgreement).toBeNull();
    expect(report.measurements.tokenUsage).toBeNull();
    expect(report.checks.languageFixtureAgreement?.denominator).toBe(4);
    expect(report.byScope[0]!.latencyP95Ms).toBeNull();
  });
});

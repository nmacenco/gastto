import { describe, it, expect, vi } from 'vitest';
import {
  buildSemanticDataset,
  buildOfflineRouter,
  buildOfflineResponses,
} from '../../../__tests__/factories/semantic-router';
import { OfflineSemanticRouterAdapter } from '../../../infrastructure/adapters/llm/OfflineSemanticRouterAdapter';
import { EvaluateSemanticRouter, decisionsEqual } from './EvaluateSemanticRouter';
import { observeLexicalBaseline } from './observeLexicalBaseline';
import { EvaluationDatasetSchema } from './contracts';

function run(dataset = buildSemanticDataset(), router = buildOfflineRouter()) {
  return new EvaluateSemanticRouter().execute({
    dataset,
    router,
    baselineObserver: observeLexicalBaseline,
    sourceVersion: 'test-source',
  });
}
describe('offline semantic evaluation', () => {
  it('runs smoke fixtures, separates failures and exposes no message or decision text', async () => {
    const report = await run();
    expect(report.passed).toBe(true);
    expect(report.counts).toEqual({ total: 12, language: 8, protocol: 3, deterministicOnly: 1 });
    expect(report.checks.protocol).toEqual({ numerator: 3, denominator: 3, value: 1 });
    expect(report.baseline.notEvaluated).toBeGreaterThan(0);
    expect(report.cases.find((c) => c.id === 'bank-notification')?.baseline).toMatchObject({
      status: 'observed',
      outcome: 'enqueued',
    });
    expect(report.cases.find((c) => c.id === 'mixed-correction')?.baseline).toEqual({
      status: 'not_evaluated',
      reason: 'model_dependent',
    });
    expect(report.measurements.modelAccuracy).toBeNull();
    for (const secret of ['Mercadona', 'SANTANDER', '16,55', 'rawMessage', 'userReference'])
      expect(JSON.stringify(report)).not.toContain(secret);
    expect(await run()).toEqual(report);
  });

  it('compares reference and clarification reason, not just action', () => {
    expect(
      decisionsEqual(
        { action: 'select_option', userReference: '1' },
        { action: 'select_option', userReference: '2' },
      ),
    ).toBe(false);
    expect(
      decisionsEqual(
        { action: 'request_clarification', reason: 'mixed_intents' },
        { action: 'request_clarification', reason: 'ambiguous_intent' },
      ),
    ).toBe(false);
  });

  it('does not generate fixture output from expected labels', async () => {
    const dataset = buildSemanticDataset();
    dataset.cases[0]!.acceptedDecisions = [{ action: 'out_of_scope' }];
    const report = await run(dataset);
    expect(report.passed).toBe(false);
    expect(report.mismatchedCaseIds).toEqual(['bank-notification']);
  });

  it('rejects empty datasets, duplicate IDs and inconsistent failure labels before routing', async () => {
    const dataset = buildSemanticDataset();
    expect(EvaluationDatasetSchema.safeParse({ ...dataset, cases: [] }).success).toBe(false);
    expect(
      EvaluationDatasetSchema.safeParse({ ...dataset, cases: [dataset.cases[0], dataset.cases[0]] })
        .success,
    ).toBe(false);
    dataset.cases[0]!.expectedFailure = 'TIMEOUT';
    const router = buildOfflineRouter();
    const spy = vi.spyOn(router, 'decide');
    await expect(run(dataset, router)).rejects.toThrow('INVALID_DATASET');
    expect(spy).not.toHaveBeenCalled();
  });

  it('marks missing protocol responses incomplete and does not leak exception contents', async () => {
    const report = await run(buildSemanticDataset(), new OfflineSemanticRouterAdapter({}));
    expect(report.complete).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.cases.every((c) => c.errorCode === 'PROVIDER_ERROR')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('MISSING_PROTOCOL_FIXTURE');
  });

  it('reports zero language denominators as null', async () => {
    const dataset = buildSemanticDataset();
    dataset.cases = dataset.cases.filter((c) => c.expectedFailure !== null);
    const report = await run(dataset, new OfflineSemanticRouterAdapter(buildOfflineResponses()));
    expect(report.checks.languageFixtureAgreement?.value).toBeNull();
    expect(report.checks.clarificationRecall.value).toBeNull();
  });
});

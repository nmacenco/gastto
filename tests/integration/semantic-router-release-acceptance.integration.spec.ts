import { describe, expect, it } from 'vitest';
import { EvaluateSemanticRouterRelease } from '../../src/application/use-cases/evaluation/EvaluateSemanticRouterRelease';
import type { SemanticRolloutObservation } from '../../src/application/use-cases/evaluation/release-contracts';

const candidate = {
  provider: 'openai' as const,
  model: 'gpt-4o-mini-2024-07-18',
  promptVersion: 'semantic-openai-v3',
  contractVersion: 'semantic-contract-v2',
  policyVersion: 'semantic-policy-v3',
  datasetVersion: 'semantic-corpus-v6',
  labelVersion: 'semantic-labels-v6',
};

function observation(
  evidenceKind: SemanticRolloutObservation['evidenceKind'],
  capability: SemanticRolloutObservation['capability'],
): SemanticRolloutObservation {
  return {
    schemaVersion: 'semantic-rollout-observation-v1',
    evidenceKind,
    occurredAt: '2026-09-19T12:00:00.000Z',
    releaseId: 'release-1',
    deploymentVersion: 'deployment-1',
    environment: 'test',
    mode: 'enabled',
    cohort: 'candidate',
    state: capability === 'option_selection' ? 'ONBOARDING_FILE' : 'EXPENSE_REVIEW',
    substep: null,
    capability,
    outcomeCode: evidenceKind,
    provider: null,
    model: null,
    promptVersion: null,
    contractVersion: candidate.contractVersion,
    policyVersion: candidate.policyVersion,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
  };
}

describe('Integration :: semantic router release acceptance', () => {
  it('keeps option/control outcomes out of the completed-expense denominator', () => {
    const report = new EvaluateSemanticRouterRelease().execute({
      manifest: {
        schemaVersion: 'semantic-release-evidence-manifest-v1',
        releaseId: 'release-1',
        sourceVersion: 'source-1',
        requestedStage: 'expanded_enabled',
        candidate,
        artifacts: [],
      },
      thresholds: {
        schemaVersion: 'semantic-release-thresholds-pending-v1',
        status: 'pending_owner_approval',
        candidate,
        missingFields: ['numeric_gates'],
      },
      evidence: {
        controlledRolloutRuntime: {
          schemaVersion: 'semantic-runtime-evidence-v1',
          releaseId: 'release-1',
          observationWindow: {
            startedAt: '2026-09-19T10:00:00.000Z',
            endedAt: '2026-09-19T12:00:00.000Z',
          },
          observations: [
            observation('eligible_task_started', 'expense'),
            observation('task_failed', 'expense'),
            observation('eligible_task_started', 'option_selection'),
            observation('task_completed', 'option_selection'),
            observation('eligible_task_started', 'control'),
            observation('task_completed', 'control'),
          ],
          acknowledgmentLatencyMs: [],
        },
      },
      evidenceDigests: {},
      generatedAt: '2026-09-19T12:00:00.000Z',
    });

    expect(report.metrics.taskCompletionByCohort.candidate).toEqual({
      eligible: 1,
      completed: 0,
    });
    expect(report.metrics.costPerCompletedExpense.value).toBeNull();
    expect(report.decision).toBe('hold');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { RecordSemanticRolloutObservation } from './rollout-telemetry';
import type { SemanticRolloutObservation } from '../../use-cases/evaluation/release-contracts';

const observation: SemanticRolloutObservation = {
  schemaVersion: 'semantic-rollout-observation-v1',
  evidenceKind: 'task_completed',
  occurredAt: '2026-09-19T12:00:00.000Z',
  releaseId: 'candidate-1',
  deploymentVersion: 'deployment-v1',
  environment: 'staging',
  mode: 'enabled',
  cohort: 'candidate',
  state: 'EXPENSE_REVIEW',
  substep: null,
  capability: 'expense',
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

describe('RecordSemanticRolloutObservation', () => {
  it('records only the strict aggregate-safe allowlist', () => {
    const recordRollout = vi.fn();
    const recorder = new RecordSemanticRolloutObservation({ recordRollout });
    expect(recorder.execute(observation)).toBe(true);
    expect(recordRollout).toHaveBeenCalledWith(observation);
    expect(
      recorder.execute({ ...observation, userId: 'private' } as SemanticRolloutObservation),
    ).toBe(false);
    expect(recordRollout).toHaveBeenCalledTimes(1);
  });

  it('contains sink failures without changing application behavior', () => {
    const recorder = new RecordSemanticRolloutObservation({
      recordRollout: () => {
        throw new Error('sink unavailable');
      },
    });
    expect(recorder.execute(observation)).toBe(false);
  });
});

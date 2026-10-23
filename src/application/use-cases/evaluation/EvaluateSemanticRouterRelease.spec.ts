import { describe, expect, it } from 'vitest';
import { EvaluateSemanticRouterRelease } from './EvaluateSemanticRouterRelease';
import {
  ReleaseThresholdInputSchema,
  SemanticRolloutObservationSchema,
  SemanticRouterReleaseThresholdsSchema,
  type CandidateVersionSchema,
  type ImplementationEvidence,
  type ProposalEvaluationEvidence,
  type ReleaseEvidenceManifest,
  type RuntimeEvidence,
  type SemanticRouterReleaseThresholds,
} from './release-contracts';
import type { z } from 'zod';

const candidate: z.infer<typeof CandidateVersionSchema> = {
  provider: 'openai',
  model: 'gpt-4o-mini-2024-07-18',
  promptVersion: 'semantic-openai-v3',
  contractVersion: 'semantic-contract-v2',
  policyVersion: 'semantic-policy-v3',
  datasetVersion: 'semantic-corpus-v6',
  labelVersion: 'semantic-labels-v6',
};
const sourceVersion = 'source-v1';
const scope = 'EXPENSE_REVIEW/default';

function manifest(requestedStage: ReleaseEvidenceManifest['requestedStage'] = 'shadow') {
  return {
    schemaVersion: 'semantic-release-evidence-manifest-v1',
    releaseId: 'candidate-1',
    sourceVersion,
    requestedStage,
    candidate,
    artifacts: [],
  } satisfies ReleaseEvidenceManifest;
}

function thresholds(): SemanticRouterReleaseThresholds {
  return {
    schemaVersion: 'semantic-release-thresholds-v1',
    thresholdVersion: 'thresholds-v1',
    candidate,
    approvedBy: {
      productOwner: 'Product Owner',
      techLead: 'Tech Lead',
      approvedAt: '2026-09-19T10:00:00.000Z',
    },
    minimums: {
      heldOutCases: 1,
      shadowSamplesByScope: 1,
      enabledTaskStartsByScope: 1,
      observationWindowHours: 1,
    },
    gates: {
      minimumActionAccuracyByScope: { [scope]: 0.8 },
      minimumAmbiguityDetectionByScope: { [scope]: 0.8 },
      maximumUnnecessaryClarificationByScope: { [scope]: 0.2 },
      maximumSchemaFailureRate: 0.1,
      maximumP95RouterLatencyMsByScope: { [scope]: 1000 },
      maximumAcknowledgmentP95Ms: 1000,
      maximumCostPerCompletedExpense: 1,
      minimumTaskCompletionLift: 0,
      maximumCriticalFalseAuthorizations: 0,
      maximumUnauthorizedEffects: 0,
    },
    pricing: {
      version: 'pricing-v1',
      currency: 'USD',
      effectiveAt: '2026-09-19T10:00:00.000Z',
      source: 'Approved provider price sheet',
      rates: {
        'gpt-4o-mini-2024-07-18': { inputPerMillion: 1, outputPerMillion: 2 },
      },
    },
  };
}

function implementation(): ImplementationEvidence {
  return {
    schemaVersion: 'semantic-implementation-evidence-v1',
    sourceVersion,
    candidate,
    status: 'passed',
    recordedAt: '2026-09-19T10:00:00.000Z',
    suites: [{ name: 'unit', status: 'passed', scenarios: 2, tests: 10 }],
    criticalFalseAuthorizationCount: 0,
    unauthorizedEffectCount: 0,
  };
}

function proposal(
  evidenceClass: ProposalEvaluationEvidence['evidenceClass'],
  split: ProposalEvaluationEvidence['split'],
): ProposalEvaluationEvidence {
  return {
    schemaVersion: 'semantic-proposal-evidence-v1',
    evidenceClass,
    split,
    complete: true,
    passed: true,
    sourceVersion,
    candidate,
    totalCases: 10,
    perScopeActionAccuracy: { [scope]: { numerator: 9, denominator: 10 } },
    ambiguityDetection: { [scope]: { numerator: 9, denominator: 10 } },
    unnecessaryClarification: { [scope]: { numerator: 1, denominator: 10 } },
    schemaFailures: { numerator: 0, denominator: 10 },
    p95RouterLatencyMsByScope: { [scope]: { value: 50, samples: 10 } },
    criticalFalseAuthorizationCount: 0,
    unauthorizedEffectCount: evidenceClass === 'live_provider' ? 0 : null,
  };
}

function baseEvidence() {
  return {
    implementation: implementation(),
    offlineDevelopment: proposal('protocol_fixture_replay', 'development'),
    offlineHeldOut: proposal('protocol_fixture_replay', 'held_out'),
    liveHeldOut: proposal('live_provider', 'held_out'),
  };
}

function runtime(): RuntimeEvidence {
  const common = {
    schemaVersion: 'semantic-rollout-observation-v1' as const,
    occurredAt: '2026-09-19T10:30:00.000Z',
    releaseId: 'candidate-1',
    deploymentVersion: 'deployment-v1',
    environment: 'staging' as const,
    mode: 'enabled' as const,
    state: 'EXPENSE_REVIEW',
    substep: null,
    capability: 'expense' as const,
    contractVersion: candidate.contractVersion,
    policyVersion: candidate.policyVersion,
    latencyMs: null,
  };
  return {
    schemaVersion: 'semantic-runtime-evidence-v1',
    releaseId: 'candidate-1',
    observationWindow: {
      startedAt: '2026-09-19T10:00:00.000Z',
      endedAt: '2026-09-19T12:00:00.000Z',
    },
    acknowledgmentLatencyMs: [20, 40],
    observations: [
      ...(['deterministic', 'candidate'] as const).flatMap((cohort) => [
        {
          ...common,
          evidenceKind: 'eligible_task_started' as const,
          cohort,
          outcomeCode: 'direct_expense',
          provider: null,
          model: null,
          promptVersion: null,
          inputTokens: null,
          outputTokens: null,
        },
        {
          ...common,
          evidenceKind: 'task_completed' as const,
          cohort,
          outcomeCode: 'saved',
          provider: null,
          model: null,
          promptVersion: null,
          inputTokens: null,
          outputTokens: null,
        },
      ]),
      {
        ...common,
        evidenceKind: 'router_call',
        cohort: 'candidate',
        outcomeCode: 'allowed',
        provider: candidate.provider,
        model: candidate.model,
        promptVersion: candidate.promptVersion,
        latencyMs: 50,
        inputTokens: 100,
        outputTokens: 10,
      },
    ],
  };
}

describe('release contracts', () => {
  it('rejects privacy-unsafe fields and incomplete scoped thresholds', () => {
    const observation = runtime().observations[0]!;
    expect(
      SemanticRolloutObservationSchema.safeParse({ ...observation, userId: 'private-user' })
        .success,
    ).toBe(false);
    const invalid = thresholds();
    invalid.gates.minimumAmbiguityDetectionByScope = {};
    expect(SemanticRouterReleaseThresholdsSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts an explicit pending threshold artifact without invented values', () => {
    expect(
      ReleaseThresholdInputSchema.parse({
        schemaVersion: 'semantic-release-thresholds-pending-v1',
        status: 'pending_owner_approval',
        candidate,
        missingFields: ['numeric_gates', 'pricing'],
      }),
    ).toBeTruthy();
  });
});

describe('EvaluateSemanticRouterRelease', () => {
  it('produces a fail-closed Phase 1 report with missing external evidence', () => {
    const report = new EvaluateSemanticRouterRelease().execute({
      manifest: manifest(),
      thresholds: {
        schemaVersion: 'semantic-release-thresholds-pending-v1',
        status: 'pending_owner_approval',
        candidate,
        missingFields: [
          'threshold_version',
          'product_owner_approval',
          'tech_lead_approval',
          'numeric_minimums',
          'numeric_gates',
          'pricing',
        ],
      },
      evidence: {
        implementation: implementation(),
        offlineDevelopment: proposal('protocol_fixture_replay', 'development'),
        offlineHeldOut: proposal('protocol_fixture_replay', 'held_out'),
      },
      evidenceDigests: {},
      generatedAt: '2026-09-19T12:00:00.000Z',
    });
    expect(report.decision).toBe('hold');
    expect(report.evidence.implementation).toBe('passed');
    expect(report.evidence.offlineHeldOut).toBe('passed');
    expect(report.evidence.liveHeldOut).toBe('blocked_missing_evidence');
    expect(report.metrics.taskCompletionByCohort.candidate).toEqual({ completed: 0, eligible: 0 });
    expect(report.metrics.costPerCompletedExpense).toEqual({
      value: null,
      currency: null,
      usageComplete: false,
    });
  });

  it('approves only the requested shadow stage when all its gates pass', () => {
    const report = new EvaluateSemanticRouterRelease().execute({
      manifest: manifest('shadow'),
      thresholds: thresholds(),
      evidence: baseEvidence(),
      evidenceDigests: {},
      generatedAt: '2026-09-19T12:00:00.000Z',
    });
    expect(report.decision).toBe('approved_for_next_stage');
    expect(report.uncertainty.perScopeActionAccuracy[scope]).toMatchObject({
      confidence: 0.95,
      method: 'wilson-descriptive',
    });
  });

  it('fails closed for drift and rolls back for any observed critical event', () => {
    const drifted = proposal('live_provider', 'held_out');
    drifted.candidate = { ...candidate, promptVersion: 'changed-prompt' };
    const driftReport = new EvaluateSemanticRouterRelease().execute({
      manifest: manifest(),
      thresholds: thresholds(),
      evidence: { ...baseEvidence(), liveHeldOut: drifted },
      evidenceDigests: {},
      generatedAt: '2026-09-19T12:00:00.000Z',
    });
    expect(driftReport.decision).toBe('hold');
    expect(driftReport.evidence.liveHeldOut).toBe('failed');

    const unsafe = implementation();
    unsafe.criticalFalseAuthorizationCount = 1;
    const unsafeReport = new EvaluateSemanticRouterRelease().execute({
      manifest: manifest(),
      thresholds: thresholds(),
      evidence: { ...baseEvidence(), implementation: unsafe },
      evidenceDigests: {},
      generatedAt: '2026-09-19T12:00:00.000Z',
    });
    expect(unsafeReport.decision).toBe('rollback');
  });

  it.each([
    'model',
    'promptVersion',
    'contractVersion',
    'policyVersion',
    'datasetVersion',
    'labelVersion',
  ] as const)('fails the live gate on %s drift', (field) => {
    const drifted = proposal('live_provider', 'held_out');
    drifted.candidate = { ...candidate, [field]: `changed-${field}` };
    const report = new EvaluateSemanticRouterRelease().execute({
      manifest: manifest(),
      thresholds: thresholds(),
      evidence: { ...baseEvidence(), liveHeldOut: drifted },
      evidenceDigests: {},
      generatedAt: '2026-09-19T12:00:00.000Z',
    });
    expect(report.evidence.liveHeldOut).toBe('failed');
    expect(report.decision).toBe('hold');
  });

  it('rejects missing candidate pricing and fails the proposal gate on source drift', () => {
    const missingPrice = thresholds();
    missingPrice.pricing.rates = {};
    expect(SemanticRouterReleaseThresholdsSchema.safeParse(missingPrice).success).toBe(false);
    const sourceDrift = proposal('live_provider', 'held_out');
    sourceDrift.sourceVersion = 'changed-source';
    const report = new EvaluateSemanticRouterRelease().execute({
      manifest: manifest(),
      thresholds: thresholds(),
      evidence: { ...baseEvidence(), liveHeldOut: sourceDrift },
      evidenceDigests: {},
      generatedAt: '2026-09-19T12:00:00.000Z',
    });
    expect(report.gates.find((item) => item.name === 'live_held_out')?.reasonCodes).toContain(
      'source_version_drift',
    );
    expect(report.evidence.liveHeldOut).toBe('failed');
  });

  it('preserves zero denominators and blocks incomplete usage and unknown outcomes', () => {
    const rollout = runtime();
    rollout.observations.push({
      ...rollout.observations[0]!,
      evidenceKind: 'task_outcome_unknown',
      cohort: 'candidate',
      outcomeCode: 'lease_lost',
    });
    const routerCall = rollout.observations.find((item) => item.evidenceKind === 'router_call')!;
    routerCall.outputTokens = null;
    const report = new EvaluateSemanticRouterRelease().execute({
      manifest: manifest('expanded_enabled'),
      thresholds: thresholds(),
      evidence: { ...baseEvidence(), controlledRolloutRuntime: rollout },
      evidenceDigests: {},
      generatedAt: '2026-09-19T12:00:00.000Z',
    });
    expect(report.metrics.costPerCompletedExpense.usageComplete).toBe(false);
    expect(report.gates.find((item) => item.name === 'controlled_rollout')?.reasonCodes).toEqual(
      expect.arrayContaining(['unknown_task_outcomes', 'expense_usage_incomplete']),
    );
    expect(report.decision).toBe('hold');
  });
});

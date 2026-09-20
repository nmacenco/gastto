import { percentile, wilsonInterval } from './statistics';
import {
  ImplementationEvidenceSchema,
  ProposalEvaluationEvidenceSchema,
  ReleaseEvidenceManifestSchema,
  ReleaseThresholdInputSchema,
  RuntimeEvidenceSchema,
  SemanticRouterAcceptanceReportSchema,
  SemanticRouterRolloutRecordSchema,
  type ImplementationEvidence,
  type ProposalEvaluationEvidence,
  type ReleaseEvidenceManifest,
  type ReleaseGateStatus,
  type ReleaseThresholdInput,
  type RuntimeEvidence,
  type SemanticRouterAcceptanceReport,
  type SemanticRouterReleaseThresholds,
  type SemanticRouterRolloutRecord,
  type SemanticRolloutObservation,
} from './release-contracts';

export interface SemanticRouterReleaseEvidence {
  implementation?: ImplementationEvidence;
  offlineDevelopment?: ProposalEvaluationEvidence;
  offlineHeldOut?: ProposalEvaluationEvidence;
  liveHeldOut?: ProposalEvaluationEvidence;
  shadowRuntime?: RuntimeEvidence;
  controlledRolloutRuntime?: RuntimeEvidence;
  rollbackRecord?: SemanticRouterRolloutRecord;
}

export interface EvaluateSemanticRouterReleaseInput {
  readonly manifest: ReleaseEvidenceManifest;
  readonly thresholds: ReleaseThresholdInput;
  readonly evidence: SemanticRouterReleaseEvidence;
  readonly evidenceDigests: Readonly<Record<string, string>>;
  readonly generatedAt?: string;
}

interface GateResult {
  name: string;
  status: ReleaseGateStatus;
  reasonCodes: string[];
}

const emptyCount = () => ({ numerator: 0, denominator: 0 });
const emptyLatency = () => ({ value: null, samples: 0 });

function versionsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function gate(name: string, reasons: string[], failedReasons: string[] = []): GateResult {
  const failed = reasons.filter((reason) => failedReasons.includes(reason));
  return {
    name,
    status: failed.length ? 'failed' : reasons.length ? 'blocked_missing_evidence' : 'passed',
    reasonCodes: reasons,
  };
}

function proposalGate(
  name: string,
  evidence: ProposalEvaluationEvidence | undefined,
  expectedClass: ProposalEvaluationEvidence['evidenceClass'],
  expectedSplit: ProposalEvaluationEvidence['split'],
  manifest: ReleaseEvidenceManifest,
): GateResult {
  if (!evidence) return gate(name, ['evidence_missing']);
  const reasons: string[] = [];
  if (evidence.evidenceClass !== expectedClass) reasons.push('evidence_class_mismatch');
  if (evidence.split !== expectedSplit) reasons.push('split_mismatch');
  if (!evidence.complete) reasons.push('incomplete_run');
  if (!evidence.passed) reasons.push('checks_failed');
  if (evidence.sourceVersion !== manifest.sourceVersion) reasons.push('source_version_drift');
  if (!versionsEqual(evidence.candidate, manifest.candidate))
    reasons.push('candidate_version_drift');
  return gate(name, reasons, [
    'evidence_class_mismatch',
    'split_mismatch',
    'checks_failed',
    'source_version_drift',
    'candidate_version_drift',
  ]);
}

function implementationGate(
  evidence: ImplementationEvidence | undefined,
  manifest: ReleaseEvidenceManifest,
): GateResult {
  if (!evidence) return gate('implementation', ['evidence_missing']);
  const reasons: string[] = [];
  if (evidence.status !== 'passed' || evidence.suites.some((suite) => suite.status !== 'passed'))
    reasons.push('implementation_checks_failed');
  if (evidence.sourceVersion !== manifest.sourceVersion) reasons.push('source_version_drift');
  if (!versionsEqual(evidence.candidate, manifest.candidate))
    reasons.push('candidate_version_drift');
  return gate('implementation', reasons, [
    'implementation_checks_failed',
    'source_version_drift',
    'candidate_version_drift',
  ]);
}

function runtimeObservations(runtime: RuntimeEvidence | undefined): SemanticRolloutObservation[] {
  return runtime?.observations ?? [];
}

function scopeOf(observation: SemanticRolloutObservation): string {
  return `${observation.state}/${observation.substep ?? 'default'}`;
}

function runtimeVersionReasons(
  runtime: RuntimeEvidence | undefined,
  manifest: ReleaseEvidenceManifest,
): string[] {
  if (!runtime) return ['evidence_missing'];
  const reasons = new Set<string>();
  if (runtime.releaseId !== manifest.releaseId) reasons.add('release_id_mismatch');
  if (new Set(runtime.observations.map((item) => item.deploymentVersion)).size > 1)
    reasons.add('deployment_version_drift');
  for (const observation of runtime.observations) {
    if (observation.releaseId !== manifest.releaseId) reasons.add('release_id_mismatch');
    if (
      observation.contractVersion !== manifest.candidate.contractVersion ||
      observation.policyVersion !== manifest.candidate.policyVersion
    )
      reasons.add('candidate_version_drift');
    if (
      observation.evidenceKind === 'router_call' &&
      (observation.provider !== manifest.candidate.provider ||
        observation.model !== manifest.candidate.model ||
        observation.promptVersion !== manifest.candidate.promptVersion)
    )
      reasons.add('candidate_version_drift');
  }
  return [...reasons];
}

function elapsedHours(runtime: RuntimeEvidence): number {
  return (
    (Date.parse(runtime.observationWindow.endedAt) -
      Date.parse(runtime.observationWindow.startedAt)) /
    3_600_000
  );
}

function thresholdReasons(
  thresholds: ReleaseThresholdInput,
  manifest: ReleaseEvidenceManifest,
): string[] {
  if (thresholds.schemaVersion === 'semantic-release-thresholds-pending-v1')
    return ['thresholds_unapproved', ...thresholds.missingFields];
  return versionsEqual(thresholds.candidate, manifest.candidate)
    ? []
    : ['threshold_candidate_version_drift'];
}

function liveThresholdReasons(
  evidence: ProposalEvaluationEvidence | undefined,
  thresholds: SemanticRouterReleaseThresholds | null,
): string[] {
  if (!evidence || !thresholds) return [];
  const reasons: string[] = [];
  if (evidence.totalCases < thresholds.minimums.heldOutCases)
    reasons.push('held_out_sample_shortfall');
  const scopes = Object.keys(thresholds.gates.minimumActionAccuracyByScope);
  for (const scope of scopes) {
    const accuracy = evidence.perScopeActionAccuracy[scope];
    const ambiguity = evidence.ambiguityDetection[scope];
    const clarification = evidence.unnecessaryClarification[scope];
    const latency = evidence.p95RouterLatencyMsByScope[scope];
    if (!accuracy || !accuracy.denominator) reasons.push('action_accuracy_sample_missing');
    else if (
      accuracy.numerator / accuracy.denominator <
      thresholds.gates.minimumActionAccuracyByScope[scope]!
    )
      reasons.push('action_accuracy_breached');
    if (!ambiguity || !ambiguity.denominator) reasons.push('ambiguity_sample_missing');
    else if (
      ambiguity.numerator / ambiguity.denominator <
      thresholds.gates.minimumAmbiguityDetectionByScope[scope]!
    )
      reasons.push('ambiguity_detection_breached');
    if (!clarification || !clarification.denominator) reasons.push('clarification_sample_missing');
    else if (
      clarification.numerator / clarification.denominator >
      thresholds.gates.maximumUnnecessaryClarificationByScope[scope]!
    )
      reasons.push('unnecessary_clarification_breached');
    if (!latency || latency.value === null || !latency.samples)
      reasons.push('router_latency_sample_missing');
    else if (latency.value > thresholds.gates.maximumP95RouterLatencyMsByScope[scope]!)
      reasons.push('router_latency_breached');
  }
  if (!evidence.schemaFailures.denominator) reasons.push('schema_failure_sample_missing');
  else if (
    evidence.schemaFailures.numerator / evidence.schemaFailures.denominator >
    thresholds.gates.maximumSchemaFailureRate
  )
    reasons.push('schema_failure_budget_breached');
  if (evidence.criticalFalseAuthorizationCount) reasons.push('critical_false_authorization');
  if (evidence.unauthorizedEffectCount === null) reasons.push('unauthorized_effect_unmeasured');
  else if (evidence.unauthorizedEffectCount) reasons.push('unauthorized_effect');
  return [...new Set(reasons)];
}

function safetyCounts(evidence: SemanticRouterReleaseEvidence) {
  const implementation = evidence.implementation;
  const proposals = [evidence.offlineDevelopment, evidence.offlineHeldOut, evidence.liveHeldOut];
  const observations = [evidence.shadowRuntime, evidence.controlledRolloutRuntime].flatMap(
    runtimeObservations,
  );
  return {
    falseAuthorizations:
      (implementation?.criticalFalseAuthorizationCount ?? 0) +
      proposals.reduce((sum, item) => sum + (item?.criticalFalseAuthorizationCount ?? 0), 0) +
      observations.filter((item) => item.evidenceKind === 'false_authorization_observed').length,
    unauthorizedEffects: proposals.some(
      (item) => item !== undefined && item.unauthorizedEffectCount === null,
    )
      ? null
      : (implementation?.unauthorizedEffectCount ?? 0) +
        proposals.reduce((sum, item) => sum + (item?.unauthorizedEffectCount ?? 0), 0) +
        observations.filter((item) => item.evidenceKind === 'unauthorized_effect_observed').length,
  };
}

function shadowGate(
  runtime: RuntimeEvidence | undefined,
  manifest: ReleaseEvidenceManifest,
  thresholds: SemanticRouterReleaseThresholds | null,
): GateResult {
  const reasons = runtimeVersionReasons(runtime, manifest);
  if (!runtime || !thresholds) return gate('shadow', [...reasons, 'thresholds_unapproved']);
  if (elapsedHours(runtime) < thresholds.minimums.observationWindowHours)
    reasons.push('observation_window_shortfall');
  const calls = runtime.observations.filter(
    (item) => item.evidenceKind === 'router_call' && item.mode === 'shadow',
  );
  for (const scope of Object.keys(thresholds.gates.minimumActionAccuracyByScope))
    if (
      calls.filter((call) => scopeOf(call) === scope).length <
      thresholds.minimums.shadowSamplesByScope
    )
      reasons.push('shadow_sample_shortfall');
  if (
    runtime.observations.some(
      (item) => item.mode === 'shadow' && item.outcomeCode === 'effect_applied',
    )
  )
    reasons.push('shadow_side_effect');
  return gate(
    'shadow',
    [...new Set(reasons)],
    [
      'release_id_mismatch',
      'candidate_version_drift',
      'deployment_version_drift',
      'shadow_side_effect',
    ],
  );
}

function taskCounts(observations: SemanticRolloutObservation[]) {
  const count = (cohort: SemanticRolloutObservation['cohort'], kind: string) =>
    observations.filter(
      (item) =>
        item.cohort === cohort && item.capability === 'expense' && item.evidenceKind === kind,
    ).length;
  return {
    deterministic: {
      completed: count('deterministic', 'task_completed'),
      eligible: count('deterministic', 'eligible_task_started'),
    },
    candidate: {
      completed: count('candidate', 'task_completed'),
      eligible: count('candidate', 'eligible_task_started'),
    },
  };
}

function controlledRolloutGate(
  runtime: RuntimeEvidence | undefined,
  manifest: ReleaseEvidenceManifest,
  thresholds: SemanticRouterReleaseThresholds | null,
): GateResult {
  const reasons = runtimeVersionReasons(runtime, manifest);
  if (!runtime || !thresholds)
    return gate('controlled_rollout', [...reasons, 'thresholds_unapproved']);
  if (elapsedHours(runtime) < thresholds.minimums.observationWindowHours)
    reasons.push('observation_window_shortfall');
  const enabledStarts = runtime.observations.filter(
    (item) => item.evidenceKind === 'eligible_task_started' && item.mode === 'enabled',
  );
  for (const scope of Object.keys(thresholds.gates.minimumActionAccuracyByScope))
    if (
      enabledStarts.filter((start) => scopeOf(start) === scope).length <
      thresholds.minimums.enabledTaskStartsByScope
    )
      reasons.push('enabled_sample_shortfall');
  const counts = taskCounts(runtime.observations);
  if (!counts.deterministic.eligible || !counts.candidate.eligible)
    reasons.push('task_completion_denominator_missing');
  else if (
    counts.candidate.completed / counts.candidate.eligible -
      counts.deterministic.completed / counts.deterministic.eligible <
    thresholds.gates.minimumTaskCompletionLift
  )
    reasons.push('task_completion_lift_breached');
  if (runtime.observations.some((item) => item.evidenceKind === 'task_outcome_unknown'))
    reasons.push('unknown_task_outcomes');
  if (!runtime.acknowledgmentLatencyMs.length) reasons.push('acknowledgment_latency_missing');
  else if (
    percentile(runtime.acknowledgmentLatencyMs, 0.95)! > thresholds.gates.maximumAcknowledgmentP95Ms
  )
    reasons.push('acknowledgment_latency_breached');
  const expenseCalls = runtime.observations.filter(
    (item) =>
      item.cohort === 'candidate' &&
      item.capability === 'expense' &&
      ['router_call', 'extraction_call', 'correction_call'].includes(item.evidenceKind),
  );
  if (
    !expenseCalls.length ||
    expenseCalls.some((call) => call.inputTokens === null || call.outputTokens === null)
  )
    reasons.push('expense_usage_incomplete');
  if (!counts.candidate.completed) reasons.push('completed_expense_missing');
  return gate(
    'controlled_rollout',
    [...new Set(reasons)],
    [
      'release_id_mismatch',
      'candidate_version_drift',
      'deployment_version_drift',
      'task_completion_lift_breached',
      'acknowledgment_latency_breached',
    ],
  );
}

function rollbackGate(
  record: SemanticRouterRolloutRecord | undefined,
  manifest: ReleaseEvidenceManifest,
): GateResult {
  if (!record) return gate('rollback_exercise', ['evidence_missing']);
  const reasons: string[] = [];
  if (record.releaseId !== manifest.releaseId) reasons.push('release_id_mismatch');
  if (record.stage !== 'rolled_back' || record.rollbackVerifiedAt === null)
    reasons.push('rollback_not_verified');
  return gate('rollback_exercise', reasons, ['release_id_mismatch', 'rollback_not_verified']);
}

function calculateCost(
  runtime: RuntimeEvidence | undefined,
  thresholds: SemanticRouterReleaseThresholds | null,
  completedExpenses: number,
) {
  if (!runtime || !thresholds)
    return { value: null, currency: thresholds?.pricing.currency ?? null, usageComplete: false };
  const calls = runtime.observations.filter(
    (item) =>
      item.cohort === 'candidate' &&
      item.capability === 'expense' &&
      ['router_call', 'extraction_call', 'correction_call'].includes(item.evidenceKind),
  );
  const usageComplete =
    calls.length > 0 &&
    calls.every(
      (call) =>
        call.inputTokens !== null &&
        call.outputTokens !== null &&
        call.model !== null &&
        thresholds.pricing.rates[call.model] !== undefined,
    );
  if (!usageComplete || !completedExpenses)
    return { value: null, currency: thresholds.pricing.currency, usageComplete: false };
  const total = calls.reduce((sum, call) => {
    const price = thresholds.pricing.rates[call.model!]!;
    return (
      sum +
      (call.inputTokens! * price.inputPerMillion + call.outputTokens! * price.outputPerMillion) /
        1_000_000
    );
  }, 0);
  return { value: total / completedExpenses, currency: thresholds.pricing.currency, usageComplete };
}

function validateEvidence(input: EvaluateSemanticRouterReleaseInput): void {
  ReleaseEvidenceManifestSchema.parse(input.manifest);
  ReleaseThresholdInputSchema.parse(input.thresholds);
  if (input.evidence.implementation)
    ImplementationEvidenceSchema.parse(input.evidence.implementation);
  for (const proposal of [
    input.evidence.offlineDevelopment,
    input.evidence.offlineHeldOut,
    input.evidence.liveHeldOut,
  ])
    if (proposal) ProposalEvaluationEvidenceSchema.parse(proposal);
  for (const runtime of [input.evidence.shadowRuntime, input.evidence.controlledRolloutRuntime])
    if (runtime) RuntimeEvidenceSchema.parse(runtime);
  if (input.evidence.rollbackRecord)
    SemanticRouterRolloutRecordSchema.parse(input.evidence.rollbackRecord);
}

export class EvaluateSemanticRouterRelease {
  execute(input: EvaluateSemanticRouterReleaseInput): SemanticRouterAcceptanceReport {
    validateEvidence(input);
    const approvedThresholds =
      input.thresholds.schemaVersion === 'semantic-release-thresholds-v1' ? input.thresholds : null;
    const thresholdGate = gate('thresholds', thresholdReasons(input.thresholds, input.manifest), [
      'threshold_candidate_version_drift',
    ]);
    const implementation = implementationGate(input.evidence.implementation, input.manifest);
    const offlineDevelopment = proposalGate(
      'offline_development',
      input.evidence.offlineDevelopment,
      'protocol_fixture_replay',
      'development',
      input.manifest,
    );
    const offlineHeldOut = proposalGate(
      'offline_held_out',
      input.evidence.offlineHeldOut,
      'protocol_fixture_replay',
      'held_out',
      input.manifest,
    );
    const liveHeldOutBase = proposalGate(
      'live_held_out',
      input.evidence.liveHeldOut,
      'live_provider',
      'held_out',
      input.manifest,
    );
    const liveReasons = [
      ...liveHeldOutBase.reasonCodes,
      ...liveThresholdReasons(input.evidence.liveHeldOut, approvedThresholds),
      ...(approvedThresholds ? [] : ['thresholds_unapproved']),
    ];
    const liveHeldOut = gate(
      'live_held_out',
      [...new Set(liveReasons)],
      [
        'evidence_class_mismatch',
        'split_mismatch',
        'checks_failed',
        'source_version_drift',
        'candidate_version_drift',
        'action_accuracy_breached',
        'ambiguity_detection_breached',
        'unnecessary_clarification_breached',
        'router_latency_breached',
        'schema_failure_budget_breached',
        'critical_false_authorization',
        'unauthorized_effect',
      ],
    );
    const shadow = shadowGate(input.evidence.shadowRuntime, input.manifest, approvedThresholds);
    const controlledRollout = controlledRolloutGate(
      input.evidence.controlledRolloutRuntime,
      input.manifest,
      approvedThresholds,
    );
    const rollbackExercise = rollbackGate(input.evidence.rollbackRecord, input.manifest);
    const gates = [
      thresholdGate,
      implementation,
      offlineDevelopment,
      offlineHeldOut,
      liveHeldOut,
      shadow,
      controlledRollout,
      rollbackExercise,
    ];
    const safety = safetyCounts(input.evidence);
    const runtime = input.evidence.controlledRolloutRuntime;
    const tasks = taskCounts(runtimeObservations(runtime));
    const cost = calculateCost(runtime, approvedThresholds, tasks.candidate.completed);
    if (
      approvedThresholds &&
      cost.value !== null &&
      cost.value > approvedThresholds.gates.maximumCostPerCompletedExpense
    ) {
      controlledRollout.status = 'failed';
      controlledRollout.reasonCodes.push('expense_cost_budget_breached');
    }
    const sourceMetrics =
      input.evidence.liveHeldOut ??
      input.evidence.offlineHeldOut ??
      input.evidence.offlineDevelopment;
    const actionAccuracy = sourceMetrics?.perScopeActionAccuracy ?? {};
    const uncertainty = Object.fromEntries(
      Object.entries(actionAccuracy).flatMap(([scope, value]) => {
        const interval = wilsonInterval(value.numerator, value.denominator);
        return interval
          ? [
              [
                scope,
                {
                  lower: interval.lower,
                  upper: interval.upper,
                  confidence: 0.95 as const,
                  method: 'wilson-descriptive' as const,
                },
              ],
            ]
          : [];
      }),
    );
    const required = [
      thresholdGate,
      implementation,
      offlineDevelopment,
      offlineHeldOut,
      liveHeldOut,
    ];
    if (input.manifest.requestedStage !== 'shadow') required.push(shadow);
    if (input.manifest.requestedStage === 'expanded_enabled')
      required.push(controlledRollout, rollbackExercise);
    const decision =
      safety.falseAuthorizations > 0 ||
      (safety.unauthorizedEffects !== null && safety.unauthorizedEffects > 0)
        ? 'rollback'
        : required.every((item) => item.status === 'passed')
          ? 'approved_for_next_stage'
          : 'hold';
    const acknowledgment = runtime?.acknowledgmentLatencyMs ?? [];
    const report: SemanticRouterAcceptanceReport = {
      schemaVersion: 'semantic-acceptance-report-v1',
      releaseId: input.manifest.releaseId,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      sourceVersion: input.manifest.sourceVersion,
      thresholdVersion: approvedThresholds?.thresholdVersion ?? 'pending',
      evidenceDigests: input.evidenceDigests,
      candidate: input.manifest.candidate,
      evidence: {
        implementation: implementation.status,
        offlineDevelopment: offlineDevelopment.status,
        offlineHeldOut: offlineHeldOut.status,
        liveHeldOut: liveHeldOut.status,
        shadow: shadow.status,
        controlledRollout: controlledRollout.status,
        rollbackExercise: rollbackExercise.status,
      },
      metrics: {
        perScopeActionAccuracy: actionAccuracy,
        ambiguityDetection: sourceMetrics?.ambiguityDetection ?? {},
        unnecessaryClarification: sourceMetrics?.unnecessaryClarification ?? {},
        schemaFailures: sourceMetrics?.schemaFailures ?? emptyCount(),
        p95RouterLatencyMsByScope: sourceMetrics?.p95RouterLatencyMsByScope ?? {},
        acknowledgmentP95Ms: {
          value: percentile(acknowledgment, 0.95),
          samples: acknowledgment.length,
        },
        taskCompletionByCohort: tasks,
        costPerCompletedExpense: cost,
        criticalFalseAuthorizationCount: safety.falseAuthorizations,
        unauthorizedEffectCount: safety.unauthorizedEffects,
      },
      uncertainty: { perScopeActionAccuracy: uncertainty },
      gates,
      decision,
    };
    if (!Object.keys(report.metrics.p95RouterLatencyMsByScope).length)
      report.metrics.p95RouterLatencyMsByScope = {};
    if (!report.metrics.acknowledgmentP95Ms.samples)
      report.metrics.acknowledgmentP95Ms = emptyLatency();
    return SemanticRouterAcceptanceReportSchema.parse(report);
  }
}

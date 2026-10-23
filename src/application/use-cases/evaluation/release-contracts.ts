import { z } from 'zod';

const identifier = z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/);
const version = z.string().regex(/^[a-zA-Z0-9._/-]{1,120}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const isoDateTime = z.string().datetime({ offset: true });
const scope = z.string().regex(/^[A-Z][A-Z0-9_]{1,79}\/(?:default|[a-z0-9_-]{1,80})$/);
const finiteNonnegative = z.number().finite().nonnegative();
const finitePositive = z.number().finite().positive();
const probability = z.number().finite().min(0).max(1);

export const CandidateVersionSchema = z
  .object({
    provider: z.literal('openai'),
    model: version,
    promptVersion: identifier,
    contractVersion: identifier,
    policyVersion: identifier,
    datasetVersion: identifier,
    labelVersion: identifier,
  })
  .strict();

const scopedProbability = z.record(scope, probability);
const scopedLatency = z.record(scope, finitePositive);

export const SemanticRouterReleaseThresholdsSchema = z
  .object({
    schemaVersion: z.literal('semantic-release-thresholds-v1'),
    thresholdVersion: identifier,
    candidate: CandidateVersionSchema,
    approvedBy: z
      .object({
        productOwner: z.string().trim().min(1).max(120),
        techLead: z.string().trim().min(1).max(120),
        approvedAt: isoDateTime,
      })
      .strict(),
    minimums: z
      .object({
        heldOutCases: z.number().int().positive().max(1000),
        shadowSamplesByScope: z.number().int().positive().max(1_000_000),
        enabledTaskStartsByScope: z.number().int().positive().max(1_000_000),
        observationWindowHours: finitePositive.max(24 * 90),
      })
      .strict(),
    gates: z
      .object({
        minimumActionAccuracyByScope: scopedProbability,
        minimumAmbiguityDetectionByScope: scopedProbability,
        maximumUnnecessaryClarificationByScope: scopedProbability,
        maximumSchemaFailureRate: probability,
        maximumP95RouterLatencyMsByScope: scopedLatency,
        maximumAcknowledgmentP95Ms: finitePositive,
        maximumCostPerCompletedExpense: finitePositive,
        minimumTaskCompletionLift: z.number().finite().min(-1).max(1),
        maximumCriticalFalseAuthorizations: z.literal(0),
        maximumUnauthorizedEffects: z.literal(0),
      })
      .strict(),
    pricing: z
      .object({
        version: identifier,
        currency: z.string().regex(/^[A-Z]{3}$/),
        effectiveAt: isoDateTime,
        source: z.string().trim().min(1).max(500),
        rates: z.record(
          version,
          z
            .object({
              inputPerMillion: finiteNonnegative,
              outputPerMillion: finiteNonnegative,
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()
  .superRefine((thresholds, ctx) => {
    const scopeSets = [
      thresholds.gates.minimumActionAccuracyByScope,
      thresholds.gates.minimumAmbiguityDetectionByScope,
      thresholds.gates.maximumUnnecessaryClarificationByScope,
      thresholds.gates.maximumP95RouterLatencyMsByScope,
    ].map((record) => Object.keys(record).sort().join('\n'));
    if (!scopeSets[0] || scopeSets.some((candidate) => candidate !== scopeSets[0]))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gates'],
        message: 'Every activation scope must define every scoped gate',
      });
    if (!thresholds.pricing.rates[thresholds.candidate.model])
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pricing', 'rates'],
        message: 'Candidate model pricing is required',
      });
  });

export const PendingReleaseThresholdsSchema = z
  .object({
    schemaVersion: z.literal('semantic-release-thresholds-pending-v1'),
    status: z.literal('pending_owner_approval'),
    candidate: CandidateVersionSchema,
    missingFields: z
      .array(
        z.enum([
          'threshold_version',
          'product_owner_approval',
          'tech_lead_approval',
          'numeric_minimums',
          'numeric_gates',
          'pricing',
        ]),
      )
      .min(1),
  })
  .strict();

export const ReleaseThresholdInputSchema = z.union([
  SemanticRouterReleaseThresholdsSchema,
  PendingReleaseThresholdsSchema,
]);

export type SemanticRouterReleaseThresholds = z.infer<typeof SemanticRouterReleaseThresholdsSchema>;
export type ReleaseThresholdInput = z.infer<typeof ReleaseThresholdInputSchema>;

export const SemanticRolloutEvidenceKindSchema = z.enum([
  'eligible_task_started',
  'task_completed',
  'task_cancelled',
  'task_timed_out',
  'task_failed',
  'task_outcome_unknown',
  'router_call',
  'extraction_call',
  'correction_call',
  'false_authorization_observed',
  'unauthorized_effect_observed',
]);

export const SemanticRolloutObservationSchema = z
  .object({
    schemaVersion: z.literal('semantic-rollout-observation-v1'),
    evidenceKind: SemanticRolloutEvidenceKindSchema,
    occurredAt: isoDateTime,
    releaseId: identifier,
    deploymentVersion: version,
    environment: z.enum(['test', 'staging', 'production']),
    mode: z.enum(['off', 'shadow', 'enabled']),
    cohort: z.enum(['deterministic', 'candidate']),
    state: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
    substep: z
      .string()
      .regex(/^[a-z0-9_-]{1,80}$/)
      .nullable(),
    capability: z.enum(['expense', 'option_selection', 'control']),
    outcomeCode: identifier,
    provider: version.nullable(),
    model: version.nullable(),
    promptVersion: identifier.nullable(),
    contractVersion: identifier,
    policyVersion: identifier,
    latencyMs: finiteNonnegative.nullable(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .superRefine((observation, ctx) => {
    const modelCall = ['router_call', 'extraction_call', 'correction_call'].includes(
      observation.evidenceKind,
    );
    if (
      modelCall !==
      (observation.provider !== null &&
        observation.model !== null &&
        observation.promptVersion !== null)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provider, model and prompt metadata are required only for model calls',
      });
  });

export type SemanticRolloutObservation = z.infer<typeof SemanticRolloutObservationSchema>;

const countedRateSchema = z
  .object({
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) => value.numerator <= value.denominator, 'Numerator exceeds denominator');
const measuredLatencySchema = z
  .object({ value: finiteNonnegative.nullable(), samples: z.number().int().nonnegative() })
  .strict()
  .refine(
    (value) => (value.samples === 0) === (value.value === null),
    'Latency value and samples are inconsistent',
  );

export const ProposalEvaluationEvidenceSchema = z
  .object({
    schemaVersion: z.literal('semantic-proposal-evidence-v1'),
    evidenceClass: z.enum(['protocol_fixture_replay', 'live_provider']),
    split: z.enum(['development', 'held_out']),
    complete: z.boolean(),
    passed: z.boolean(),
    sourceVersion: version,
    candidate: CandidateVersionSchema,
    totalCases: z.number().int().positive().max(1000),
    perScopeActionAccuracy: z.record(scope, countedRateSchema),
    ambiguityDetection: z.record(scope, countedRateSchema),
    unnecessaryClarification: z.record(scope, countedRateSchema),
    schemaFailures: countedRateSchema,
    p95RouterLatencyMsByScope: z.record(scope, measuredLatencySchema),
    criticalFalseAuthorizationCount: z.number().int().nonnegative(),
    unauthorizedEffectCount: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type ProposalEvaluationEvidence = z.infer<typeof ProposalEvaluationEvidenceSchema>;

export const ImplementationEvidenceSchema = z
  .object({
    schemaVersion: z.literal('semantic-implementation-evidence-v1'),
    sourceVersion: version,
    candidate: CandidateVersionSchema,
    status: z.enum(['passed', 'failed']),
    recordedAt: isoDateTime,
    suites: z
      .array(
        z
          .object({
            name: identifier,
            status: z.enum(['passed', 'failed']),
            scenarios: z.number().int().nonnegative(),
            tests: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1),
    criticalFalseAuthorizationCount: z.number().int().nonnegative(),
    unauthorizedEffectCount: z.number().int().nonnegative(),
  })
  .strict();

export type ImplementationEvidence = z.infer<typeof ImplementationEvidenceSchema>;

export const RuntimeEvidenceSchema = z
  .object({
    schemaVersion: z.literal('semantic-runtime-evidence-v1'),
    releaseId: identifier,
    observationWindow: z
      .object({ startedAt: isoDateTime, endedAt: isoDateTime })
      .strict()
      .refine((window) => Date.parse(window.endedAt) > Date.parse(window.startedAt), {
        message: 'Observation window must end after it starts',
      }),
    observations: z.array(SemanticRolloutObservationSchema).max(1_000_000),
    acknowledgmentLatencyMs: z.array(finiteNonnegative).max(1_000_000),
  })
  .strict();

export type RuntimeEvidence = z.infer<typeof RuntimeEvidenceSchema>;

export const SemanticRouterRolloutRecordSchema = z
  .object({
    schemaVersion: z.literal('semantic-rollout-record-v1'),
    releaseId: identifier,
    stage: z.enum(['shadow', 'limited_enabled', 'expanded_enabled', 'rolled_back']),
    states: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/)).min(1),
    cohortPercent: finiteNonnegative.max(100),
    shadowSamplePercent: finiteNonnegative.max(100),
    startedAt: isoDateTime,
    endedAt: isoDateTime.nullable(),
    observationWindowHours: finitePositive.max(24 * 90),
    accountableOwner: z.string().trim().min(1).max(120),
    technicalOperator: z.string().trim().min(1).max(120),
    approvalReference: z.string().trim().min(1).max(500),
    priorConfigurationDigest: digest,
    appliedConfigurationDigest: digest,
    acceptanceReportDigest: digest,
    stopReason: z.string().trim().min(1).max(500).nullable(),
    rollbackVerifiedAt: isoDateTime.nullable(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if ((record.stage === 'rolled_back') !== (record.rollbackVerifiedAt !== null))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rollbackVerifiedAt'],
        message: 'Rollback verification is required only for a rolled-back stage',
      });
  });

export type SemanticRouterRolloutRecord = z.infer<typeof SemanticRouterRolloutRecordSchema>;

export const EvidenceKindSchema = z.enum([
  'implementation',
  'offline_development',
  'offline_held_out',
  'live_held_out',
  'shadow_runtime',
  'controlled_rollout_runtime',
  'rollback_record',
]);

export const ReleaseEvidenceManifestSchema = z
  .object({
    schemaVersion: z.literal('semantic-release-evidence-manifest-v1'),
    releaseId: identifier,
    sourceVersion: version,
    requestedStage: z.enum(['shadow', 'limited_enabled', 'expanded_enabled']),
    candidate: CandidateVersionSchema,
    artifacts: z
      .array(
        z
          .object({
            kind: EvidenceKindSchema,
            file: z.string().regex(/^[a-zA-Z0-9._/-]{1,240}$/),
            sha256: digest,
          })
          .strict(),
      )
      .max(7),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const kinds = manifest.artifacts.map((artifact) => artifact.kind);
    if (new Set(kinds).size !== kinds.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate evidence kind' });
    if (new Set(manifest.artifacts.map((artifact) => artifact.file)).size !== kinds.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate evidence file' });
  });

export type ReleaseEvidenceManifest = z.infer<typeof ReleaseEvidenceManifestSchema>;

export const ReleaseGateStatusSchema = z.enum(['passed', 'failed', 'blocked_missing_evidence']);
export type ReleaseGateStatus = z.infer<typeof ReleaseGateStatusSchema>;

export const SemanticRouterAcceptanceReportSchema = z
  .object({
    schemaVersion: z.literal('semantic-acceptance-report-v1'),
    releaseId: identifier,
    generatedAt: isoDateTime,
    sourceVersion: version,
    thresholdVersion: identifier.or(z.literal('pending')),
    evidenceDigests: z.record(EvidenceKindSchema, digest),
    candidate: CandidateVersionSchema,
    evidence: z
      .object({
        implementation: ReleaseGateStatusSchema,
        offlineDevelopment: ReleaseGateStatusSchema,
        offlineHeldOut: ReleaseGateStatusSchema,
        liveHeldOut: ReleaseGateStatusSchema,
        shadow: ReleaseGateStatusSchema,
        controlledRollout: ReleaseGateStatusSchema,
        rollbackExercise: ReleaseGateStatusSchema,
      })
      .strict(),
    metrics: z
      .object({
        perScopeActionAccuracy: z.record(scope, countedRateSchema),
        ambiguityDetection: z.record(scope, countedRateSchema),
        unnecessaryClarification: z.record(scope, countedRateSchema),
        schemaFailures: countedRateSchema,
        p95RouterLatencyMsByScope: z.record(scope, measuredLatencySchema),
        acknowledgmentP95Ms: measuredLatencySchema,
        taskCompletionByCohort: z
          .object({
            deterministic: z
              .object({
                completed: z.number().int().nonnegative(),
                eligible: z.number().int().nonnegative(),
              })
              .strict(),
            candidate: z
              .object({
                completed: z.number().int().nonnegative(),
                eligible: z.number().int().nonnegative(),
              })
              .strict(),
          })
          .strict(),
        costPerCompletedExpense: z
          .object({
            value: finiteNonnegative.nullable(),
            currency: z
              .string()
              .regex(/^[A-Z]{3}$/)
              .nullable(),
            usageComplete: z.boolean(),
          })
          .strict(),
        criticalFalseAuthorizationCount: z.number().int().nonnegative(),
        unauthorizedEffectCount: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    uncertainty: z
      .object({
        perScopeActionAccuracy: z.record(
          scope,
          z
            .object({
              lower: probability,
              upper: probability,
              confidence: z.literal(0.95),
              method: z.literal('wilson-descriptive'),
            })
            .strict(),
        ),
      })
      .strict(),
    gates: z.array(
      z
        .object({
          name: identifier,
          status: ReleaseGateStatusSchema,
          reasonCodes: z.array(identifier),
        })
        .strict(),
    ),
    decision: z.enum(['approved_for_next_stage', 'hold', 'rollback']),
  })
  .strict();

export type SemanticRouterAcceptanceReport = z.infer<typeof SemanticRouterAcceptanceReportSchema>;

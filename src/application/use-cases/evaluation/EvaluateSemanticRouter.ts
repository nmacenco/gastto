import { z } from 'zod';
import type {
  SemanticRouterPort,
  SemanticRouterMetadata,
} from '../../../domain/ports/SemanticRouterPort';
import type { ConversationDecision } from '../../../domain/value-objects/conversation-decision';
import {
  assessSemanticProposal,
  CONTRACT_VERSION,
  SemanticRouterResultSchema,
} from '../../services/semantic-router/contracts';
import { POLICY_VERSION, STATE_ACTION_POLICY } from '../../services/semantic-router/policy';
import {
  ResolveOptionReference,
  type ResolveOptionReferenceResult,
} from '../../services/semantic-router/ResolveOptionReference';
import { EvaluationDatasetSchema, type EvaluationCase, type EvaluationDataset } from './contracts';
import type { observeLexicalBaseline, BaselineObservation } from './observeLexicalBaseline';
import { rate, percentile, wilsonInterval } from './statistics';

const RunSettingsSchema = z
  .object({
    model: z.string().regex(/^[a-zA-Z0-9._/-]{1,120}$/),
    timeoutMs: z.number().int().min(1).max(60000),
    maxOutputTokens: z.number().int().min(64).max(4096),
    maxCases: z.number().int().min(1).max(1000),
    concurrency: z.literal(1),
    maxRetries: z.literal(0),
  })
  .strict();
const digestsSchema = z
  .object({
    dataset: z.string().regex(/^[a-f0-9]{64}$/),
    responses: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();
export interface EvaluationRunInput {
  mode?: 'offline' | 'live';
  executionSettings?: z.infer<typeof RunSettingsSchema> | null;
  artifactDigests?: z.infer<typeof digestsSchema>;
  selection?: {
    split: 'development' | 'held_out';
    available: number;
    excludedProtocol: number;
    excludedDeterministic: number;
    omittedByLimit: number;
  };
  dataset: EvaluationDataset;
  router: SemanticRouterPort;
  baselineObserver: typeof observeLexicalBaseline;
  sourceVersion: string;
}
export function caseKind(item: EvaluationCase): 'language' | 'protocol' | 'deterministic_only' {
  return item.tags.includes('protocol') ||
    item.expectedFailure !== null ||
    item.expectedAssessment === 'forbidden_action'
    ? 'protocol'
    : item.expectedHandling === 'deterministic_only'
      ? 'deterministic_only'
      : 'language';
}
export interface CaseResult {
  id: string;
  state: string;
  substep: string | null;
  kind: ReturnType<typeof caseKind>;
  passed: boolean;
  assessment: 'allowed' | 'forbidden_action' | 'router_failure';
  expectedAssessment: 'allowed' | 'forbidden_action' | 'router_failure';
  errorCode: string | null;
  proposedAction: ConversationDecision['action'] | null;
  expectedClarification: boolean;
  predictedClarification: boolean;
  critical: boolean;
  control: boolean;
  falseAuthorization: boolean;
  baseline: BaselineObservation;
  comparison: {
    dimension: 'ingress_admission' | 'review_cancel';
    baselineMatched: boolean;
    candidateMatched: boolean;
  } | null;
  optionResolution: {
    expectedStatus: ResolveOptionReferenceResult['status'];
    actualStatus: ResolveOptionReferenceResult['status'] | null;
    passed: boolean;
  } | null;
}
export function decisionsEqual(a: ConversationDecision, b: ConversationDecision): boolean {
  if (a.action !== b.action) return false;
  if (a.action === 'select_option')
    return b.action === 'select_option' && a.userReference === b.userReference;
  if (a.action === 'request_clarification')
    return b.action === 'request_clarification' && a.reason === b.reason;
  return true;
}
function languageChecks(cases: CaseResult[]) {
  const language = cases.filter((c) => c.kind === 'language');
  const tp = language.filter((c) => c.expectedClarification && c.predictedClarification).length;
  const fp = language.filter((c) => !c.expectedClarification && c.predictedClarification).length;
  const fn = language.filter((c) => c.expectedClarification && !c.predictedClarification).length;
  const tn = language.length - tp - fp - fn;
  return {
    agreement: rate(language.filter((c) => c.passed).length, language.length),
    confusion: { truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn },
    clarificationPrecision: rate(tp, tp + fp),
    clarificationRecall: rate(tp, tp + fn),
    unnecessaryClarification: rate(fp, fp + tn),
  };
}
function comparison(
  item: EvaluationCase,
  baseline: BaselineObservation,
  assessment: ReturnType<typeof assessSemanticProposal>,
): CaseResult['comparison'] {
  if (caseKind(item) !== 'language' || baseline.status !== 'observed') return null;
  const project = (action: ConversationDecision['action']) =>
    action === 'out_of_scope'
      ? 'guidance'
      : ['register_expense', 'undo_last_expense', 'cancel_current_flow'].includes(action)
        ? 'enqueued'
        : null;
  if (item.input.substep === null && ['IDLE', 'EXPENSE_RECEIVING'].includes(item.input.state)) {
    const expected = item.acceptedDecisions.map((d) => project(d.action));
    if (expected.some((p) => p === null)) return null;
    return {
      dimension: 'ingress_admission',
      baselineMatched: expected.some((outcome) => outcome === baseline.outcome),
      candidateMatched:
        assessment.status === 'allowed' && expected.includes(project(assessment.decision.action)),
    };
  }
  if (
    item.input.state === 'EXPENSE_REVIEW' &&
    item.acceptedDecisions.every((d) => d.action === 'cancel_current_flow')
  )
    return {
      dimension: 'review_cancel',
      baselineMatched: baseline.outcome === 'cancel',
      candidateMatched:
        assessment.status === 'allowed' && assessment.decision.action === 'cancel_current_flow',
    };
  return null;
}
function safeBaseline(baseline: BaselineObservation): BaselineObservation {
  // Do not serialize an injected observer's object or additional fields.
  if (
    baseline.status === 'observed' &&
    baseline.provenance === 'current_lexical_execution' &&
    ['guidance', 'enqueued', 'confirm', 'cancel'].includes(baseline.outcome)
  )
    return {
      status: 'observed',
      provenance: 'current_lexical_execution',
      outcome: baseline.outcome,
    };
  return {
    status: 'not_evaluated',
    reason:
      baseline.status === 'not_evaluated' && baseline.reason === 'model_dependent'
        ? 'model_dependent'
        : 'unsupported_scope',
  };
}
export class EvaluateSemanticRouter {
  async execute(input: EvaluationRunInput) {
    const dataset = EvaluationDatasetSchema.safeParse(input.dataset);
    if (!dataset.success) throw new Error('INVALID_DATASET');
    const live = input.mode === 'live';
    const settings = live ? RunSettingsSchema.safeParse(input.executionSettings) : null;
    if (
      live &&
      (!settings?.success ||
        dataset.data.cases.length > settings.data.maxCases ||
        dataset.data.cases.some((c) => caseKind(c) !== 'language'))
    )
      throw new Error('INVALID_LIVE_SETTINGS');
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(input.sourceVersion))
      throw new Error('INVALID_SOURCE_VERSION');
    const artifactDigests = input.artifactDigests
      ? digestsSchema.parse(input.artifactDigests)
      : null;
    const selection = input.selection
      ? z
          .object({
            split: z.enum(['development', 'held_out']),
            available: z.number().int().nonnegative(),
            excludedProtocol: z.number().int().nonnegative(),
            excludedDeterministic: z.number().int().nonnegative(),
            omittedByLimit: z.number().int().nonnegative(),
          })
          .strict()
          .parse(input.selection)
      : null;
    const measured: { scope: string; metadata: SemanticRouterMetadata }[] = [];
    const cases: CaseResult[] = [];
    let complete = true;
    const versions = new Set<string>();
    for (const item of dataset.data.cases) {
      const baseline = safeBaseline(input.baselineObserver(item.input));
      let assessment: ReturnType<typeof assessSemanticProposal>;
      try {
        const result = await input.router.decide(item.input);
        const parsed = SemanticRouterResultSchema.safeParse(result);
        if (parsed.success) {
          const m = parsed.data.metadata;
          measured.push({
            scope: `${item.input.state}/${item.input.substep ?? 'default'}`,
            metadata: m,
          });
          versions.add(`${m.provider}:${m.model}:${m.promptVersion}`);
          if (live && (m.provider === 'offline' || m.model !== settings?.data?.model))
            throw new Error('INCOMPATIBLE_ROUTER');
        }
        assessment = assessSemanticProposal(item.input, result);
      } catch {
        complete = false;
        assessment = { status: 'router_failure', code: 'PROVIDER_ERROR' };
      }
      if (live && assessment.status === 'router_failure') complete = false;
      const proposalPassed =
        assessment.status === item.expectedAssessment &&
        (assessment.status === 'router_failure'
          ? item.expectedFailure === assessment.code
          : item.acceptedDecisions.some((d) => decisionsEqual(d, assessment.decision)));
      let resolutionResult: ResolveOptionReferenceResult | null = null;
      if (
        item.optionResolution &&
        assessment.status === 'allowed' &&
        assessment.decision.action === 'select_option'
      )
        resolutionResult = new ResolveOptionReference().execute({
          userReference: assessment.decision.userReference,
          expected: item.optionResolution.expected,
          current: item.optionResolution.current,
        });
      const resolutionPassed =
        !item.optionResolution ||
        (resolutionResult !== null &&
          JSON.stringify(resolutionResult) ===
            JSON.stringify(item.optionResolution.expectedResult));
      const passed = proposalPassed && resolutionPassed;
      cases.push({
        id: item.id,
        state: item.input.state,
        substep: item.input.substep,
        kind: caseKind(item),
        passed,
        assessment: assessment.status,
        expectedAssessment: item.expectedAssessment,
        errorCode: assessment.status === 'router_failure' ? assessment.code : null,
        proposedAction: assessment.status === 'router_failure' ? null : assessment.decision.action,
        expectedClarification: item.expectedHandling === 'clarify',
        predictedClarification:
          assessment.status === 'allowed' && assessment.decision.action === 'request_clarification',
        critical: item.mustNotAuthorize.length > 0,
        control: item.tags.includes('control'),
        falseAuthorization:
          item.tags.includes('control') &&
          item.mustNotAuthorize.length > 0 &&
          item.expectedAssessment !== 'allowed' &&
          assessment.status === 'allowed',
        baseline,
        comparison: comparison(item, baseline, assessment),
        optionResolution: item.optionResolution
          ? {
              expectedStatus: item.optionResolution.expectedResult.status,
              actualStatus: resolutionResult?.status ?? null,
              passed: resolutionPassed,
            }
          : null,
      });
    }
    const language = cases.filter((c) => c.kind === 'language'),
      protocol = cases.filter((c) => c.kind === 'protocol');
    const scopes = [...new Set(cases.map((c) => `${c.state}/${c.substep ?? 'default'}`))].sort();
    const checks = languageChecks(cases);
    const usage = (entries: typeof measured, total: number) => {
      const known = entries.filter(
        (e) => e.metadata.inputTokens !== null && e.metadata.outputTokens !== null,
      );
      const complete = known.length === total;
      return {
        complete,
        measuredCalls: known.length,
        totalCalls: total,
        inputTokens: complete ? known.reduce((n, e) => n + e.metadata.inputTokens!, 0) : null,
        outputTokens: complete ? known.reduce((n, e) => n + e.metadata.outputTokens!, 0) : null,
        observedInputTokens: known.length
          ? known.reduce((n, e) => n + e.metadata.inputTokens!, 0)
          : null,
        observedOutputTokens: known.length
          ? known.reduce((n, e) => n + e.metadata.outputTokens!, 0)
          : null,
      };
    };
    const comparisons = cases.filter((c) => c.comparison !== null);
    const controlCases = cases.filter((c) => c.control);
    const controlLanguage = controlCases.filter((c) => c.kind === 'language');
    const controlAmbiguityCases = controlLanguage.filter((c) => c.expectedClarification);
    const controlPolicyCases = controlCases.filter(
      (c) => c.expectedAssessment === 'forbidden_action',
    );
    const optionCases = cases.filter((c) => c.optionResolution !== null);
    const resolutionRate = (status: ResolveOptionReferenceResult['status']) => {
      const cohort = optionCases.filter((c) => c.optionResolution?.expectedStatus === status);
      return rate(cohort.filter((c) => c.optionResolution?.passed).length, cohort.length);
    };
    return {
      reportVersion: 'semantic-evaluation-v4',
      datasetVersion: dataset.data.version,
      datasetProvenance: dataset.data.provenance ?? null,
      artifactDigests,
      selection,
      splits: [...new Set(dataset.data.cases.map((c) => c.split))].sort(),
      contractVersion: CONTRACT_VERSION,
      policyVersion: POLICY_VERSION,
      mode: input.mode ?? 'offline',
      evidence: live ? 'live_provider' : 'protocol_fixture_replay',
      executionSettings: settings?.success ? settings.data : null,
      sourceVersion: input.sourceVersion,
      routerVersions: [...versions].sort(),
      complete,
      passed: complete && cases.every((c) => c.passed),
      counts: {
        total: cases.length,
        language: language.length,
        protocol: protocol.length,
        deterministicOnly: cases.filter((c) => c.kind === 'deterministic_only').length,
      },
      checks: {
        proposedActionAgreement: rate(
          optionCases.filter(
            (c) => c.assessment === 'allowed' && c.proposedAction === 'select_option',
          ).length,
          optionCases.length,
        ),
        uniqueResolutionAccuracy: resolutionRate('resolved'),
        ambiguityHandling: resolutionRate('ambiguous'),
        notFoundRejection: resolutionRate('not_found'),
        staleRejection: resolutionRate('stale'),
        downstreamTaskCompletion: null,
        languageFixtureAgreement: live ? null : checks.agreement,
        modelDecisionAgreement: live ? checks.agreement : null,
        protocol: rate(protocol.filter((c) => c.passed).length, protocol.length),
        clarificationPrecision: checks.clarificationPrecision,
        clarificationRecall: checks.clarificationRecall,
        unnecessaryClarification: checks.unnecessaryClarification,
        clarificationConfusion: checks.confusion,
        invalidOutput: rate(
          cases.filter((c) => c.errorCode === 'INVALID_OUTPUT').length,
          cases.length,
        ),
        policyRejection: rate(
          cases.filter((c) => c.assessment === 'forbidden_action').length,
          cases.length,
        ),
        criticalCaseFailures: rate(
          cases.filter((c) => c.critical && !c.passed).length,
          cases.filter((c) => c.critical).length,
        ),
        controlActionAgreement: rate(
          controlLanguage.filter((c) => c.passed).length,
          controlLanguage.length,
        ),
        controlAmbiguityHandling: rate(
          controlAmbiguityCases.filter((c) => c.passed && c.predictedClarification).length,
          controlAmbiguityCases.length,
        ),
        controlPolicyRejection: rate(
          controlPolicyCases.filter((c) => c.assessment === 'forbidden_action').length,
          controlPolicyCases.length,
        ),
        controlFalseAuthorizationCount: controlCases.filter((c) => c.falseAuthorization).length,
        unauthorizedEffectCount: null,
      },
      uncertainty: {
        decisionAgreement: live
          ? wilsonInterval(checks.agreement.numerator, checks.agreement.denominator)
          : null,
        note: 'Descriptive 95% binomial interval, not population confidence: synthetic related cases are not independent random samples. Offline replay has no model-quality uncertainty estimate.',
      },
      failureCounts: Object.fromEntries(
        [...new Set(cases.flatMap((c) => (c.errorCode ? [c.errorCode] : [])))]
          .sort()
          .map((code) => [code, cases.filter((c) => c.errorCode === code).length]),
      ),
      byScope: scopes.map((scope) => {
        const group = cases.filter((c) => `${c.state}/${c.substep ?? 'default'}` === scope),
          metrics = languageChecks(group);
        const calls = measured.filter((e) => e.scope === scope);
        return {
          scope,
          counts: {
            total: group.length,
            language: metrics.agreement.denominator,
            protocol: group.filter((c) => c.kind === 'protocol').length,
            deterministicOnly: group.filter((c) => c.kind === 'deterministic_only').length,
          },
          checks: rate(group.filter((c) => c.passed).length, group.length),
          language: metrics,
          invalidOutput: rate(
            group.filter((c) => c.errorCode === 'INVALID_OUTPUT').length,
            group.length,
          ),
          policyRejection: rate(
            group.filter((c) => c.assessment === 'forbidden_action').length,
            group.length,
          ),
          criticalCaseFailures: rate(
            group.filter((c) => c.critical && !c.passed).length,
            group.filter((c) => c.critical).length,
          ),
          agreementInterval: live
            ? wilsonInterval(metrics.agreement.numerator, metrics.agreement.denominator)
            : null,
          latencyP50Ms: live
            ? percentile(
                calls.map((c) => c.metadata.latencyMs),
                0.5,
              )
            : null,
          latencyP95Ms: live
            ? percentile(
                calls.map((c) => c.metadata.latencyMs),
                0.95,
              )
            : null,
          usage: live ? usage(calls, group.length) : null,
          baselineObserved: group.filter((c) => c.baseline.status === 'observed').length,
        };
      }),
      baseline: {
        observed: cases.filter((c) => c.baseline.status === 'observed').length,
        notEvaluated: cases.filter((c) => c.baseline.status === 'not_evaluated').length,
        accuracy: null,
        missingScopes: scopes.filter((scope) =>
          cases.some(
            (c) =>
              `${c.state}/${c.substep ?? 'default'}` === scope &&
              c.baseline.status === 'not_evaluated',
          ),
        ),
        note: 'Ingress and explicit-command observations are not semantic or end-to-end accuracy.',
        comparisons: ['ingress_admission', 'review_cancel'].map((dimension) => {
          const cohort = comparisons.filter((c) => c.comparison?.dimension === dimension);
          return {
            dimension,
            lexicalAgreement: rate(
              cohort.filter((c) => c.comparison?.baselineMatched).length,
              cohort.length,
            ),
            candidateAgreement: rate(
              cohort.filter((c) => c.comparison?.candidateMatched).length,
              cohort.length,
            ),
            evidence: live
              ? 'live_proposals_vs_executed_lexical_projection'
              : 'fixture_projection_vs_executed_lexical_projection',
            caseIds: cohort.map((c) => c.id),
          };
        }),
      },
      coverage: {
        unsupportedStates: Object.entries(STATE_ACTION_POLICY)
          .filter(([, steps]) => !Object.keys(steps).length)
          .map(([state]) => state),
        missingEligibleScopes: Object.entries(STATE_ACTION_POLICY)
          .flatMap(([state, steps]) => Object.keys(steps).map((step) => `${state}/${step}`))
          .filter((scope) => !scopes.includes(scope)),
        protocolOnlyScopes: scopes.filter(
          (scope) =>
            !cases.some(
              (c) => `${c.state}/${c.substep ?? 'default'}` === scope && c.kind === 'language',
            ),
        ),
      },
      measurements: {
        modelAccuracy: null,
        latencyP50Ms: live
          ? percentile(
              measured.map((e) => e.metadata.latencyMs),
              0.5,
            )
          : null,
        latencyP95Ms: live
          ? percentile(
              measured.map((e) => e.metadata.latencyMs),
              0.95,
            )
          : null,
        latencySamples: live ? measured.length : null,
        tokenUsage: live ? usage(measured, cases.length) : null,
        cost: null,
        taskCompletion: null,
        falseAuthorization: null,
        acknowledgmentLatency: null,
        unmeasuredDestinations: {
          falseAuthorization: 'master-phase-2-and-7',
          taskCompletion: 'master-phase-4-and-7',
          acknowledgmentLatency: 'master-phase-3-and-7',
          fullExpenseCost: 'master-phase-4-and-7',
        },
      },
      mismatchedCaseIds: cases.filter((c) => !c.passed).map((c) => c.id),
      cases,
    };
  }
}
export type EvaluationReport = Awaited<ReturnType<EvaluateSemanticRouter['execute']>>;
